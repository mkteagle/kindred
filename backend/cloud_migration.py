#!/usr/bin/env python3
"""Offline cloud-export inventory and NAS-copy audit. Never downloads or deletes.

Snapshots describe files, not provider asset identities or library completeness.
They cannot authorize cloud cleanup. Uses only the Python standard library.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sys


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def load_accounts(config):
    if config.get("schema_version") != 1:
        raise ValueError("Unsupported configuration schema")
    accounts = config.get("accounts", [])
    if not accounts:
        raise ValueError("At least one account is required")
    seen = set()
    roots = []
    for account in accounts:
        key = account["account_key"]
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", key) or key in seen:
            raise ValueError("Account keys must be unique lowercase slugs")
        if account["provider"] not in ("icloud", "google_photos"):
            raise ValueError("Unsupported provider")
        if not account.get("person_key"):
            raise ValueError("Each source account needs a person_key")
        root = Path(account["export_root"])
        if not root.is_absolute():
            raise ValueError("Export roots must be absolute")
        root = root.resolve()
        if any(root == other or root in other.parents or other in root.parents for other in roots):
            raise ValueError("Account export roots must not overlap")
        roots.append(root)
        seen.add(key)
    return accounts


def safe_path(root, relative):
    path = Path(relative)
    if not relative or path.is_absolute() or ".." in path.parts:
        raise ValueError("Expected a relative path within the supplied root")
    result = (root / path).resolve()
    if root not in result.parents:
        raise ValueError("Path escapes its root")
    return result


def fingerprint(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        before = os.fstat(stream.fileno())
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
        after = os.fstat(stream.fileno())
    current = path.stat()
    identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
    if identity(before) != identity(after) or identity(after) != identity(current):
        raise ValueError("File changed during hashing; retry after export finishes")
    return {"byte_size": after.st_size, "sha256": digest.hexdigest()}


def inventory(config, account_key):
    accounts = load_accounts(config)
    account = next((a for a in accounts if a["account_key"] == account_key), None)
    if account is None:
        raise ValueError("Unknown account_key")
    root = Path(account["export_root"]).resolve(strict=True)
    if not root.is_dir():
        raise ValueError("Export root must be a directory")
    files = []
    # Include every regular file: sidecars, RAWs and motion components matter too.
    # Reject symlinks rather than silently crossing accounts or missing resources.
    def walk_error(error):
        raise error
    for directory, directories, names in os.walk(root, onerror=walk_error):
        directories.sort()
        for name in directories + sorted(names):
            path = Path(directory) / name
            if path.is_symlink():
                raise ValueError("Export contains a symlink: " + str(path.relative_to(root)))
            if path.is_dir():
                continue
            if not path.is_file():
                raise ValueError("Export contains a non-regular file")
            relative = path.relative_to(root).as_posix()
            files.append({"source_relative_path": relative, **fingerprint(path),
                          "provider_asset_id": None, "nas_relative_path": None})
    return {"schema_version": 1, "account_key": account_key,
            "person_key": account["person_key"], "provider": account["provider"],
            "created_at": utc_now(), "scope": "local_export_files_only",
            "cloud_inventory_complete": False, "files": files}


def audit(snapshot, account_key, nas_root):
    if snapshot.get("schema_version") != 1 or snapshot.get("account_key") != account_key:
        raise ValueError("Snapshot schema/account mismatch")
    if snapshot.get("scope") != "local_export_files_only":
        raise ValueError("Unsupported snapshot scope")
    root = Path(nas_root).resolve(strict=True)
    if not root.is_dir():
        raise ValueError("NAS root must be a directory")
    results = []
    seen = set()
    for resource in snapshot["files"]:
        source = resource["source_relative_path"]
        if source in seen:
            raise ValueError("Duplicate source resource")
        seen.add(source)
        expected = resource["sha256"]
        size = resource["byte_size"]
        if not re.fullmatch(r"[0-9a-f]{64}", expected) or type(size) is not int or size < 0:
            raise ValueError("Invalid source fingerprint")
        status = "unmapped"
        if resource.get("nas_relative_path"):
            try:
                path = safe_path(root, resource["nas_relative_path"])
                if not path.is_file():
                    status = "missing"
                else:
                    actual = fingerprint(path)
                    status = "matches_export" if actual == {"sha256": expected, "byte_size": size} else "mismatch"
            except (OSError, ValueError):
                status = "unreadable_or_unsafe"
        results.append({"source_relative_path": source,
                        "nas_relative_path": resource.get("nas_relative_path"),
                        "nas_integrity": status})
    return {"schema_version": 1, "account_key": account_key, "checked_at": utc_now(),
            "files": results, "file_count": len(results),
            "all_export_files_match_nas": bool(results) and all(r["nas_integrity"] == "matches_export" for r in results),
            "cloud_cleanup_allowed": False,
            "blockers": ["Provider asset identities and complete library inventory are not verified",
                         "Original resource completeness and media readability are not verified",
                         "Live Flickr ownership, photo availability and all video parts are not verified",
                         "No reviewed cloud cleanup batch exists"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    scan = commands.add_parser("inventory", help="Hash a completed local export; no network")
    scan.add_argument("--config", required=True, type=Path)
    check = commands.add_parser("audit", help="Compare explicit NAS mappings against export hashes")
    check.add_argument("--snapshot", required=True, type=Path)
    check.add_argument("--nas-root", required=True, type=Path)
    for command in (scan, check):
        command.add_argument("--account", required=True)
    args = parser.parse_args()
    try:
        if args.command == "inventory":
            report = inventory(json.loads(args.config.read_text()), args.account)
        else:
            report = audit(json.loads(args.snapshot.read_text()), args.account, args.nas_root)
        print(json.dumps(report, indent=2))
        return 0 if args.command == "inventory" or report["all_export_files_match_nas"] else 2
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print("cloud-migration: " + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
