#!/usr/bin/env python3
"""Drive Firefox over VNC to download Google Takeout parts with a small queue."""

from __future__ import annotations

import argparse
import ast
import html
import json
import os
import re
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_state(path: Path, **values: object) -> None:
    state = {"updated_at": now(), **values}
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(state, indent=2) + "\n")
    temporary.replace(path)


def completed_count(download_dir: Path) -> int:
    completed: set[int] = set()
    for item in download_dir.glob("*.zip"):
        match = re.search(r"-(\d{3})\.zip$", item.name)
        if match and item.stat().st_size > 0:
            completed.add(int(match.group(1)))
    return len(completed)


def active_downloads(download_dir: Path) -> list[Path]:
    return [item for item in download_dir.glob("*.part") if item.is_file()]


def send_url(vncdo: Path, server: str, password: str, url: str) -> None:
    subprocess.run(
        [
            str(vncdo),
            "-s",
            server,
            "-p",
            password,
            "key",
            "ctrl-l",
            "type",
            url,
            "key",
            "enter",
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def capture(vncdo: Path, server: str, password: str, destination: Path) -> None:
    subprocess.run(
        [str(vncdo), "-s", server, "-p", password, "capture", str(destination)],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def press_enter(vncdo: Path, server: str, password: str) -> None:
    subprocess.run(
        [str(vncdo), "-s", server, "-p", password, "key", "enter"],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def read_firefox_clipboard(
    vncdo: Path, server: str, password: str, commands: list[str]
) -> str:
    result = subprocess.run(
        [str(vncdo), "-v", "-s", server, "-p", password, *commands, "pause", "1"],
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    matches = re.findall(r"clipboard copy (.+)$", result.stdout, flags=re.MULTILINE)
    if not matches:
        return ""
    try:
        value = ast.literal_eval(matches[-1])
    except (SyntaxError, ValueError):
        return ""
    return value if isinstance(value, str) else ""


def current_url(vncdo: Path, server: str, password: str) -> str:
    return read_firefox_clipboard(
        vncdo, server, password, ["key", "ctrl-l", "key", "ctrl-c"]
    ).strip()


def current_page_text(vncdo: Path, server: str, password: str) -> str:
    return read_firefox_clipboard(
        vncdo,
        server,
        password,
        ["key", "esc", "key", "ctrl-a", "key", "ctrl-c"],
    )


def ensure_authenticated_takeout_page(
    vncdo: Path,
    server: str,
    password: str,
    archive_page_url: str,
    log,
) -> None:
    """Repair authentication/navigation, then verify the archive page's content."""
    for attempt in range(1, 5):
        url = current_url(vncdo, server, password)
        if url.startswith("https://accounts.google.com/"):
            log(f"auth-first: submitting prefilled Google login; attempt={attempt}")
            press_enter(vncdo, server, password)
            time.sleep(12)
            continue

        if not url.startswith(archive_page_url):
            log("auth-first: navigating to the Takeout archive page")
            send_url(vncdo, server, password, archive_page_url)
            time.sleep(12)
            continue

        page_text = current_page_text(vncdo, server, password)
        lowered = page_text.lower()
        if "404" in lowered or "not found" in lowered:
            raise RuntimeError("Takeout archive page is unavailable")
        if "google photos" in lowered and "part 1" in lowered and "download" in lowered:
            log("auth-first: verified authenticated Takeout archive page")
            return
        log("auth-first: Takeout page has not finished rendering")
        time.sleep(10)

    raise RuntimeError("Could not verify an authenticated Takeout archive page")


def acquire_part_lock(queue_dir: Path, part_number: int) -> Path:
    lock_path = queue_dir / f"part-{part_number:03d}.lock"
    if lock_path.exists():
        try:
            owner_pid = int(lock_path.read_text().strip())
            os.kill(owner_pid, 0)
            raise RuntimeError(f"Part {part_number} is already owned by process {owner_pid}")
        except (ProcessLookupError, PermissionError, ValueError):
            lock_path.unlink(missing_ok=True)
    lock_path.write_text(f"{os.getpid()}\n")
    return lock_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive-html", required=True, type=Path)
    parser.add_argument("--download-dir", required=True, type=Path)
    parser.add_argument("--queue-dir", required=True, type=Path)
    parser.add_argument("--vncdo", required=True, type=Path)
    parser.add_argument("--vnc-server", default="127.0.0.1::5999")
    parser.add_argument("--vnc-password-file", required=True, type=Path)
    parser.add_argument("--poll-seconds", type=int, default=30)
    parser.add_argument("--start-index", type=int, default=1)
    parser.add_argument("--max-concurrent", type=int, default=2)
    # Retained for compatibility with older launch commands. Authentication is
    # now inspected and repaired before a part URL is submitted.
    parser.add_argument("--auto-submit-login-after", type=int, default=0)
    args = parser.parse_args()

    args.queue_dir.mkdir(parents=True, exist_ok=True)
    state_path = args.queue_dir / "takeout-queue-state.json"
    log_path = args.queue_dir / "takeout-queue.log"
    screenshot_path = args.queue_dir / "takeout-blocked.png"
    password = args.vnc_password_file.read_text().strip()

    archive = args.archive_html.read_text(errors="replace")
    candidates = re.findall(r'href="([^"]*takeout/download\?[^"]+)"', archive)
    indexed: dict[int, str] = {}
    for candidate in candidates:
        url = html.unescape(candidate)
        match = re.search(r"(?:[?&])i=(\d+)(?:&|$)", url)
        if not match:
            continue
        if url.startswith("/"):
            url = "https://takeout.google.com" + url
        elif not url.startswith("http"):
            url = "https://takeout.google.com/" + url
        index = int(match.group(1))
        if 0 <= index < 140:
            indexed[index] = url

    urls = [indexed[index] for index in sorted(indexed)]
    if len(urls) != 140:
        raise RuntimeError(f"Expected 140 Takeout parts, found {len(urls)}")
    archive_job = re.search(r"(?:[?&])j=([^&]+)", urls[0])
    if not archive_job:
        raise RuntimeError("Takeout archive job id is missing")
    archive_page_url = f"https://takeout.google.com/manage/archive/{archive_job.group(1)}"

    def log(message: str) -> None:
        with log_path.open("a") as stream:
            stream.write(f"{now()} {message}\n")

    next_index = args.start_index
    log(f"queue started; next_index={next_index}; completed={completed_count(args.download_dir)}")

    if args.max_concurrent < 1:
        raise ValueError("--max-concurrent must be at least 1")

    while next_index < len(urls) or active_downloads(args.download_dir):
        active = active_downloads(args.download_dir)
        if next_index >= len(urls) or len(active) >= args.max_concurrent:
            write_state(
                state_path,
                status="downloading-final-parts" if next_index >= len(urls) else "downloading",
                active_files=[{"name": p.name, "bytes": p.stat().st_size} for p in active],
                completed_files=completed_count(args.download_dir),
                next_part=next_index + 1 if next_index < len(urls) else None,
                total_parts=len(urls),
                max_concurrent=args.max_concurrent,
            )
            time.sleep(args.poll_seconds)
            continue

        before = completed_count(args.download_dir)
        before_active = {p.name for p in active}
        part_number = next_index + 1
        existing_part = list(args.download_dir.glob(f"*-{part_number:03d}*.part"))
        existing_complete = [
            p
            for p in args.download_dir.glob(f"*-{part_number:03d}.zip")
            if p.stat().st_size > 0
        ]
        if existing_complete:
            log(f"part {part_number} already complete; advancing without download")
            next_index += 1
            continue
        if existing_part:
            time.sleep(args.poll_seconds)
            continue

        lock_path = acquire_part_lock(args.queue_dir, part_number)
        log(f"starting part {part_number} of {len(urls)}")
        try:
            ensure_authenticated_takeout_page(
                args.vncdo,
                args.vnc_server,
                password,
                archive_page_url,
                log,
            )
            send_url(args.vncdo, args.vnc_server, password, urls[next_index])

            deadline = time.monotonic() + 300
            started = False
            while time.monotonic() < deadline:
                time.sleep(5)
                current_active = {p.name for p in active_downloads(args.download_dir)}
                if current_active - before_active or completed_count(args.download_dir) > before:
                    started = True
                    break

            if not started:
                capture(args.vncdo, args.vnc_server, password, screenshot_path)
                write_state(
                    state_path,
                    status="blocked",
                    reason=(
                        "The single submitted download did not begin within five minutes; "
                        "authentication/navigation inspection is required."
                    ),
                    failed_part=part_number,
                    completed_files=completed_count(args.download_dir),
                    screenshot=str(screenshot_path),
                    total_parts=len(urls),
                )
                log(f"blocked starting part {part_number}")
                raise RuntimeError(f"Part {part_number} did not begin")
        finally:
            lock_path.unlink(missing_ok=True)

        next_index += 1

    write_state(
        state_path,
        status="complete",
        completed_files=completed_count(args.download_dir),
        total_parts=len(urls),
    )
    log("queue complete")


if __name__ == "__main__":
    main()
