#!/usr/bin/env python3
"""Link exact Flickr originals to files already registered on the NAS."""
from __future__ import annotations

import argparse
import asyncio
from collections import Counter
from contextlib import closing
import fcntl
import hashlib
from itertools import islice
import os
from pathlib import Path
import re
import sqlite3
import time
from urllib.parse import urlsplit

import httpx
import psycopg2
from fastapi import HTTPException

from discover_nas_library import save_status
from storage.local import LocalStorageProvider
import throttle
from worker_priority import IndexingPriority

STATUS_FILE = "worker-status/flickr-match-status.json"
SIZE_INDEX = "idx_photo_copies_nas_original_size"
CHUNK_BYTES = 1024 * 1024
FLICKR_ID = re.compile(r"[0-9]{1,32}")


def original_url(value):
    if not isinstance(value, str):
        return None
    parsed = urlsplit(value)
    host = parsed.hostname or ""
    trusted = host.endswith(".staticflickr.com") or host in {"www.flickr.com", "video-downloads.flickr.com"}
    if (parsed.scheme in {"https", "http"} and trusted
            and parsed.netloc == host and not parsed.fragment):
        return parsed._replace(scheme="https").geturl()
    return None


def fingerprint_stat(value):
    return value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns


def check_nas_candidate(storage, key, size, digest):
    try:
        path = storage.resolve_local_path(key)
        if path is None:
            return None
        before = path.stat()
        if before.st_size != size:
            return None
        with path.open("rb") as stream:
            local_digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if fingerprint_stat(before) != fingerprint_stat(path.stat()):
            return None
        return local_digest == digest
    except OSError:
        return None


def candidates(query, size, media_kind):
    return query("""
        SELECT copy.photo_id::text AS photo_id, copy.provider_key, copy.sha256, copy.updated_at
        FROM photo_copies copy JOIN photos p ON p.id = copy.photo_id
        WHERE copy.provider = 'nas' AND copy.status = 'available' AND copy.byte_size = %s
          AND copy.provider_key IS NOT NULL AND p.media_kind = %s
        ORDER BY copy.photo_id
    """, (size, media_kind))


def select_match(storage, rows, size, digest):
    matches = []
    incomplete = False
    for row in rows:
        # Managed originals have a verified digest from the original write.
        # Discovered NAS files generally need an on-demand byte check.
        if row["sha256"] and row["sha256"] != digest and not row["provider_key"].startswith("library/"):
            continue
        checked = check_nas_candidate(storage, row["provider_key"], size, digest)
        if checked is None:
            incomplete = True
        elif checked:
            matches.append(row)
    if len(matches) > 1:
        return "ambiguous", None
    if incomplete:
        return "nas_unavailable", None
    if matches:
        return "matched", matches[0]
    return "unmatched", None


def record_match(query, owner, flickr_id, match, digest, size):
    """Only fill an empty link while its NAS location and household still agree."""
    saved = query("""
        INSERT INTO photo_copies
          (photo_id, provider, provider_key, provider_owner_id, remote_url,
           sha256, byte_size, status, last_synced_at)
        SELECT n.photo_id, 'flickr', %s, %s, %s, %s, %s, 'available', now()
        FROM photo_copies n
        JOIN household_flickr_connection h
          ON h.singleton AND h.verified_at IS NOT NULL AND h.flickr_user_id = %s
        WHERE n.photo_id = %s AND n.provider = 'nas'
          AND n.status = 'available' AND n.provider_key = %s AND n.byte_size = %s
          AND n.updated_at = %s
          AND NOT EXISTS (
              SELECT 1 FROM photos p WHERE p.legacy_photo_id = %s AND p.id <> n.photo_id
          )
        ON CONFLICT (photo_id, provider) DO UPDATE
        SET provider_key = EXCLUDED.provider_key, provider_owner_id = EXCLUDED.provider_owner_id,
            remote_url = EXCLUDED.remote_url, sha256 = EXCLUDED.sha256, byte_size = EXCLUDED.byte_size,
            status = 'available', last_error = NULL, last_synced_at = now(), updated_at = now()
        WHERE (photo_copies.provider_key IS NULL OR photo_copies.provider_key = EXCLUDED.provider_key)
          AND (photo_copies.provider_owner_id IS NULL OR photo_copies.provider_owner_id = EXCLUDED.provider_owner_id)
          AND photo_copies.status <> 'deleted'
        RETURNING photo_id
    """, (flickr_id, owner, f"https://www.flickr.com/photos/{owner}/{flickr_id}",
          digest, size, owner, match["photo_id"], match["provider_key"], size, match["updated_at"], flickr_id))
    return bool(saved)


async def download_digest(client, url, find_by_size, byte_limit, mime_prefix):
    for _ in range(4):
        async with client.stream("GET", url) as response:
            if not response.is_redirect:
                return await hash_response(response, find_by_size, byte_limit, mime_prefix)
            url = original_url(str(response.next_request.url)) if response.next_request else None
            if not url:
                break
    return "original_unavailable", None, None, None


async def hash_response(response, find_by_size, byte_limit, mime_prefix):
    async with asyncio.timeout(180):
        if response.status_code in {401, 403, 404}:
            return "original_unavailable", None, None, None
        response.raise_for_status()
        content_type = response.headers.get("content-type", "").split(";", 1)[0].lower()
        if response.status_code != 200 or not (
            content_type.startswith(mime_prefix) or content_type == "application/octet-stream"
        ):
            return "original_unavailable", None, None, None
        size = int(response.headers.get("content-length") or 0)
        if size > byte_limit:
            return "too_large", None, None, None
        if response.headers.get("content-encoding", "identity") != "identity":
            return "original_unavailable", None, None, None
        rows = await asyncio.to_thread(find_by_size, size) if size else None
        if rows == []:
            return "unmatched", None, None, None
        digest = hashlib.sha256()
        received = 0
        async for chunk in response.aiter_raw(CHUNK_BYTES):
            received += len(chunk)
            if received > byte_limit:
                return "too_large", None, None, None
            digest.update(chunk)
        if not received or (size and received != size):
            return "retry", None, None, None
        return "downloaded", received, digest.hexdigest(), rows


async def remote_pages(api, credentials, cutoff, albums_only):
    owner = credentials["user_id"]
    if albums_only:
        album_page = 1
        albums = []
        while True:
            data = (await api({"method": "flickr.photosets.getList", "user_id": owner,
                               "per_page": 500, "page": album_page}, credentials))["photosets"]
            albums.extend(data["photoset"])
            if album_page >= int(data["pages"]):
                break
            album_page += 1
        for album in albums:
            page = 1
            while True:
                data = (await api({"method": "flickr.photosets.getPhotos", "user_id": owner,
                                   "photoset_id": album["id"], "per_page": 500, "page": page,
                                   "media": "all", "extras": "media,url_o,last_update,date_upload"}, credentials))["photoset"]
                if data.get("owner") != owner:
                    raise RuntimeError("Flickr returned an unexpected album owner")
                yield None, [item for item in data["photo"] if int(item.get("dateupload") or 0) <= cutoff]
                if page >= int(data["pages"]):
                    break
                page += 1
        return

    page = 1
    while True:
        data = (await api({"method": "flickr.people.getPhotos", "user_id": owner,
                           "per_page": 500, "page": page, "extras": "media,url_o,last_update",
                           "max_upload_date": cutoff, "content_types": "0,1,2,3",
                           "safe_search": 3}, credentials))["photos"]
        if any(item.get("owner") != owner for item in data["photo"]):
            raise RuntimeError("Flickr returned an unexpected owner")
        yield int(data["total"]), data["photo"]
        if page >= int(data["pages"]):
            break
        page += 1


async def prioritized_pages(api, credentials, cutoff, albums_only, albums_first, on_albums_checked):
    """Reuse the album inventory before walking the remaining photostream."""
    stream = remote_pages(api, credentials, cutoff, albums_only=False)
    if not albums_first and not albums_only:
        async for page in stream:
            yield page
        return
    unique = {}
    async for _, page in remote_pages(api, credentials, cutoff, albums_only=True):
        unique.update((str(item["id"]), item) for item in page)
    first = None if albums_only else await anext(stream, None)
    total = first[0] if first else len(unique)
    items = iter(unique.values())
    while page := list(islice(items, 500)):
        yield total, page
    if on_albums_checked:
        await on_albums_checked()
    if first is not None:
        yield first
        async for page in stream:
            yield page


async def compare_item(main, storage, client, credentials, remote, byte_limit):
    flickr_id = str(remote["id"])
    media_kind = remote.get("media")
    try:
        if media_kind == "video":
            # A video's url_o is a poster image. Only Flickr's explicitly
            # labeled original video is usable as evidence of a movie match.
            data = await main.flickr_api({"method": "flickr.photos.getSizes", "photo_id": flickr_id},
                                         credentials, allow_codes={1, 2})
            url = next((original_url(size.get("source")) for size in data.get("sizes", {}).get("size", [])
                        if size.get("label") == "Video Original" and size.get("media") == "video"), None)
            if url is None:
                return "video_original_unavailable"
        elif media_kind == "photo":
            url = original_url(remote.get("url_o"))
        else:
            url = None
        if url is None:
            return "original_unavailable"
        outcome, size, digest, rows = await download_digest(
            client, url, lambda n: candidates(main.db_query, n, media_kind), byte_limit,
            "video/" if media_kind == "video" else "image/",
        )
    except (HTTPException, httpx.HTTPError, TimeoutError, ValueError):
        return "retry"
    if outcome != "downloaded":
        return outcome
    if rows is None:
        rows = await asyncio.to_thread(candidates, main.db_query, size, media_kind)
    outcome, match = await asyncio.to_thread(select_match, storage, rows, size, digest)
    if match is None:
        return outcome
    return outcome, match, digest, size


def ensure_size_index(connection):
    connection.autocommit = True
    with connection.cursor() as cursor:
        cursor.execute("SET lock_timeout = '5s'")
        cursor.execute("SET statement_timeout = '20min'")
        cursor.execute("""
            SELECT i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
            WHERE i.indrelid = 'photo_copies'::regclass AND c.relname = %s
        """, (SIZE_INDEX,))
        index = cursor.fetchone()
        if index == (True,):
            return
        if index == (False,):
            cursor.execute(f"DROP INDEX CONCURRENTLY {SIZE_INDEX}")
        cursor.execute(f"""
            CREATE INDEX CONCURRENTLY IF NOT EXISTS {SIZE_INDEX} ON photo_copies (byte_size)
            WHERE provider = 'nas' AND status = 'available' AND provider_key IS NOT NULL
        """)


async def run_pass(args, state, checkpoint, priority):
    async def wait_for_indexing():
        phase = state["phase"]

        def report_wait(reason):
            state.update(phase=reason, waiting=True)
            save_status(args.status, state)

        await priority.wait_async(report_wait)
        if state.get("waiting"):
            state.update(phase=phase, waiting=False)
            save_status(args.status, state)

    await wait_for_indexing()
    import main

    credentials = main.get_flickr_credentials()
    if not credentials or not credentials.get("verified"):
        raise RuntimeError("Verify the household Flickr connection first")
    owner = credentials["user_id"]
    # This is a separate process from live uploads and spends a smaller share
    # of the household application's shared REST quota.
    main._flickr_pacer.share = 0.08
    identity = await main.flickr_api({"method": "flickr.test.login"}, credentials)
    if identity["user"]["id"] != owner:
        raise RuntimeError("The authorized Flickr owner changed")
    root = Path(os.environ["PHOTO_STORAGE_ROOT"])
    library = Path(os.environ["PHOTO_LIBRARY_ROOT"])
    if not root.is_dir() or not library.is_dir():
        raise RuntimeError("NAS originals and library mounts are required")
    storage = LocalStorageProvider(root, library)
    stats = Counter()
    seen = set()
    reported_totals = set()
    inventory_complete = False
    async def publish_album_links():
        from flickr_album_import import import_albums

        await wait_for_indexing()
        state["phase"] = "restoring_flickr_albums"
        save_status(args.status, state)
        try:
            result = await import_albums(flickr_page, main.db_query, main._adopt_flickr_photoset, credentials)
            print(f"Flickr album reconciliation {result}", flush=True)
        except (HTTPException, psycopg2.Error):
            print("Flickr album reconciliation will retry on the next scan", flush=True)

    albums_checked = publish_album_links if not args.dry_run and args.limit is None else None

    async def flickr_page(params, creds):
        await wait_for_indexing()
        return await main.flickr_api(params, creds)

    scopes = prioritized_pages(flickr_page, credentials, int(time.time()) - 1,
                               args.albums_only, args.albums_first or args.watch, albums_checked)
    async with httpx.AsyncClient(timeout=20, trust_env=False, follow_redirects=False,
                                 headers={"User-Agent": main.FLICKR_USER_AGENT,
                                          "Accept-Encoding": "identity"}) as client:
        async for total, page in scopes:
            await wait_for_indexing()
            reported_totals.add(total)
            state["remote_total"] = max(reported_totals)
            ids = [str(item["id"]) for item in page if FLICKR_ID.fullmatch(str(item["id"]))]
            if not ids:
                continue
            links = main.db_query("""
                SELECT provider_key, provider_owner_id, status FROM photo_copies
                WHERE provider = 'flickr' AND provider_key = ANY(%s)
            """, (ids,))
            existing = {row["provider_key"]: row for row in links}
            for remote in page:
                await wait_for_indexing()
                flickr_id = str(remote["id"])
                if not FLICKR_ID.fullmatch(flickr_id) or flickr_id in seen:
                    continue
                if args.limit and len(seen) >= args.limit:
                    break
                seen.add(flickr_id)
                state["phase"] = "matching"
                prior = existing.get(flickr_id)
                revision = str(remote.get("lastupdate") or "")
                cached = checkpoint.execute("""
                    SELECT result FROM checked WHERE owner = ? AND flickr_id = ? AND revision = ?
                      AND checked_at > ?
                """, (owner, flickr_id, revision, int(time.time()) - args.retry_days * 86400)).fetchone()
                if prior and prior["provider_owner_id"] not in (None, owner):
                    outcome = "conflict"
                elif prior and prior["provider_owner_id"] == owner and prior["status"] == "available":
                    outcome = "already_linked"
                elif cached and not args.dry_run:
                    outcome = cached[0]
                else:
                    pressure = throttle.read_pressure()
                    if pressure and pressure.hurting:
                        state["phase"] = "waiting_for_capacity"
                        save_status(args.status, state)
                        await throttle.wait_for_capacity()
                        state["phase"] = "matching"
                        await wait_for_indexing()
                    compared = await compare_item(main, storage, client, credentials, remote, args.max_bytes)
                    if isinstance(compared, tuple):
                        outcome, match, digest, size = compared
                        if not args.dry_run:
                            try:
                                outcome = ("linked" if record_match(main.db_query, owner, flickr_id, match, digest, size)
                                           else "conflict")
                            except psycopg2.errors.UniqueViolation:
                                outcome = "conflict"
                    else:
                        outcome = compared
                    if not args.dry_run and outcome not in {"retry", "nas_unavailable", "linked"}:
                        with checkpoint:
                            checkpoint.execute("INSERT OR REPLACE INTO checked VALUES (?, ?, ?, ?, ?)",
                                               (owner, flickr_id, revision, outcome, int(time.time())))
                    await asyncio.sleep(args.item_delay)
                stats[outcome] += 1
                state.update(completed=len(seen), matched=stats["linked"] + stats["already_linked"] + stats["matched"],
                             failed=stats["retry"] + stats["nas_unavailable"],
                             unmatched=stats["unmatched"],
                             skipped=sum(stats[key] for key in ("conflict", "ambiguous", "too_large",
                                          "original_unavailable", "video_original_unavailable")))
                if len(seen) % 10 == 0:
                    save_status(args.status, state)
            if args.limit and len(seen) >= args.limit:
                break
        else:
            inventory_complete = len(reported_totals) <= 1 and len(seen) == (state.get("remote_total") or 0)
    return inventory_complete and not state.get("failed"), stats


async def heartbeat(path, state):
    while True:
        await asyncio.sleep(30)
        save_status(path, state)


async def run(args):
    priority = IndexingPriority()
    checkpoint_path = args.checkpoint
    checkpoint_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with checkpoint_path.with_suffix(".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with closing(sqlite3.connect(checkpoint_path)) as checkpoint:
            checkpoint.execute("""
                CREATE TABLE IF NOT EXISTS checked (
                    owner TEXT, flickr_id TEXT, revision TEXT, result TEXT, checked_at INTEGER,
                    PRIMARY KEY (owner, flickr_id)
                )
            """)
            os.chmod(checkpoint_path, 0o600)
            if not args.dry_run:
                def preparing(phase, waiting=False):
                    save_status(args.status, dict(running=True, complete=False, completed=0,
                                                 phase=phase, waiting=waiting))

                await priority.wait_async(lambda phase: preparing(phase, waiting=True))
                preparing("preparing_nas_catalog")
                with closing(psycopg2.connect(os.environ["DATABASE_URL"])) as connection:
                    ensure_size_index(connection)
            while True:
                state = dict(running=True, complete=False, phase="reading_flickr", completed=0,
                             scope="album" if args.albums_only else "account")
                save_status(args.status, state)
                reporter = asyncio.create_task(heartbeat(args.status, state))
                try:
                    complete, counts = await run_pass(args, state, checkpoint, priority)
                    state.update(running=False, complete=complete,
                                 phase="complete" if complete else "needs_review")
                    print(f"Flickr comparison results {dict(counts)}", flush=True)
                except Exception:
                    state.update(running=False, complete=False, phase="failed")
                    raise
                finally:
                    reporter.cancel()
                    await asyncio.gather(reporter, return_exceptions=True)
                    save_status(args.status, state)
                if not args.watch:
                    return
                await asyncio.sleep(args.rescan_hours * 3600)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--status", type=Path)
    parser.add_argument("--checkpoint", type=Path, default=Path("/app/flickr-match/comparison.sqlite"))
    parser.add_argument("--albums-only", action="store_true")
    parser.add_argument("--albums-first", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--watch", action="store_true")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--max-bytes", type=int, default=512 * 1024 * 1024)
    parser.add_argument("--rescan-hours", type=int, default=24)
    parser.add_argument("--retry-days", type=int, default=7)
    parser.add_argument("--item-delay", type=float, default=0.25)
    options = parser.parse_args()
    if options.status is None:
        filename = "worker-status/flickr-match-sample-status.json" if (
            options.dry_run or options.limit or options.albums_only
        ) else STATUS_FILE
        options.status = Path("/app/data") / filename
    if (options.limit is not None and options.limit < 1) or min(options.max_bytes, options.rescan_hours, options.retry_days) < 1 or options.item_delay < 0:
        parser.error("limits must be positive and delay must be nonnegative")
    asyncio.run(run(options))
