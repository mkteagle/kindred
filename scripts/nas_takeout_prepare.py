#!/usr/bin/env python3
"""Prepare a private Google Takeout cookie jar and fetch an archive page."""

from __future__ import annotations

import argparse
import shutil
import sqlite3
import tempfile
import urllib.request
from http.cookiejar import Cookie, MozillaCookieJar
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--url", required=True)
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)
    args.output.chmod(0o700)

    with tempfile.TemporaryDirectory() as temp_dir:
        snapshot = Path(temp_dir) / "cookies.sqlite"
        shutil.copy2(args.profile / "cookies.sqlite", snapshot)
        for suffix in ("-wal", "-shm"):
            source = args.profile / f"cookies.sqlite{suffix}"
            if source.exists():
                shutil.copy2(source, Path(f"{snapshot}{suffix}"))

        jar_path = args.output / "google-cookies.txt"
        jar = MozillaCookieJar(str(jar_path))
        with sqlite3.connect(snapshot) as database:
            rows = database.execute(
                """
                SELECT host, path, isSecure, expiry, name, value
                FROM moz_cookies
                WHERE host LIKE '%google.com'
                """
            )
            for host, path, secure, expiry, name, value in rows:
                jar.set_cookie(
                    Cookie(
                        version=0,
                        name=name,
                        value=value,
                        port=None,
                        port_specified=False,
                        domain=host,
                        domain_specified=host.startswith("."),
                        domain_initial_dot=host.startswith("."),
                        path=path,
                        path_specified=True,
                        secure=bool(secure),
                        expires=expiry or None,
                        discard=not bool(expiry),
                        comment=None,
                        comment_url=None,
                        rest={},
                    )
                )
        jar.save(ignore_discard=True, ignore_expires=True)
        jar_path.chmod(0o600)

    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    request = urllib.request.Request(
        args.url,
        headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Firefox/142.0"},
    )
    with opener.open(request, timeout=60) as response:
        html = response.read()
    archive_path = args.output / "archive.html"
    archive_path.write_bytes(html)
    archive_path.chmod(0o600)
    jar.save(ignore_discard=True, ignore_expires=True)

    text = html.decode("utf-8", errors="replace")
    print(f"html_bytes={len(html)}")
    print(f"download_markers={text.lower().count('download')}")
    print(f"zip_markers={text.lower().count('.zip')}")


if __name__ == "__main__":
    main()
