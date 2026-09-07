#!/usr/bin/env python3
"""
Kindred Photos — Flickr Bulk Upload Tool

Uploads a Google Takeout photo/video archive to Flickr with OAuth 1.0a signing,
then notifies the Kindred backend to trigger AI processing for each photo.

Designed for one-time bulk migrations (tested with 7TB archives).

Dependencies: requests (pip install requests)
"""

import argparse
import base64
import hashlib
import hmac
import json
import logging
import os
import re
import signal
import sys
import time
import urllib.parse
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from threading import Lock
from typing import Optional

import requests

# ── Constants ────────────────────────────────────────────────────────────────

UPLOAD_URL = "https://up.flickr.com/services/upload/"

SUPPORTED_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".gif", ".heic",
    ".mp4", ".mov", ".avi", ".mkv",
    ".webp", ".tiff", ".tif",
    ".raw", ".cr2", ".nef", ".arw",
}

VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv"}

PROGRESS_FILE = "upload_progress.json"
ERROR_LOG = "upload_errors.log"

MAX_RETRIES = 3
RETRY_BASE_DELAY = 2  # seconds — exponential backoff: 2, 4, 8

# Content-type mapping
CONTENT_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".heic": "image/heic",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".mkv": "video/x-matroska",
    ".webp": "image/webp",
    ".tiff": "image/tiff",
    ".tif": "image/tiff",
    ".raw": "image/x-raw",
    ".cr2": "image/x-canon-cr2",
    ".nef": "image/x-nikon-nef",
    ".arw": "image/x-sony-arw",
}


# ── OAuth 1.0a Signing ──────────────────────────────────────────────────────

def flickr_oauth_sign(
    url: str,
    params: dict,
    consumer_key: str,
    consumer_secret: str,
    oauth_token: str,
    oauth_secret: str,
    method: str = "GET",
) -> dict:
    """Sign a Flickr API request using OAuth 1.0a (HMAC-SHA1).

    Mirrors the signing logic from the Kindred backend (_flickr_oauth_sign).
    Returns a dict of oauth_* parameters including the signature.
    """
    oauth_params = {
        "oauth_consumer_key": consumer_key,
        "oauth_token": oauth_token,
        "oauth_signature_method": "HMAC-SHA1",
        "oauth_timestamp": str(int(time.time())),
        "oauth_nonce": uuid.uuid4().hex,
        "oauth_version": "1.0",
    }
    all_params = {**params, **oauth_params}
    sorted_params = "&".join(
        f"{urllib.parse.quote(k, '')}={urllib.parse.quote(str(v), '')}"
        for k, v in sorted(all_params.items())
    )
    base_string = f"{method}&{urllib.parse.quote(url, '')}&{urllib.parse.quote(sorted_params, '')}"
    signing_key = f"{urllib.parse.quote(consumer_secret, '')}&{urllib.parse.quote(oauth_secret, '')}"
    sig = base64.b64encode(
        hmac.new(signing_key.encode(), base_string.encode(), hashlib.sha1).digest()
    ).decode()
    oauth_params["oauth_signature"] = sig
    return oauth_params


def build_auth_header(oauth_params: dict) -> str:
    """Build an OAuth Authorization header string from signed params."""
    return "OAuth " + ", ".join(
        f'{k}="{urllib.parse.quote(str(v), "")}"'
        for k, v in oauth_params.items()
    )


# ── Google Takeout Metadata Parsing ─────────────────────────────────────────

@dataclass
class PhotoMeta:
    """Metadata parsed from a Google Takeout JSON sidecar file."""
    title: str = ""
    description: str = ""
    date_taken: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


def find_sidecar_json(photo_path: Path) -> Optional[Path]:
    """Find the Google Takeout JSON sidecar for a photo/video file.

    Takeout creates sidecar files with patterns like:
      IMG_1234.jpg.json
      IMG_1234.json  (sometimes without the extension in the json name)
    """
    # Most common: filename.ext.json
    candidate = photo_path.parent / f"{photo_path.name}.json"
    if candidate.exists():
        return candidate

    # Alternative: filename-without-ext.json
    candidate = photo_path.parent / f"{photo_path.stem}.json"
    if candidate.exists():
        return candidate

    return None


def parse_takeout_json(json_path: Path) -> PhotoMeta:
    """Parse a Google Takeout JSON sidecar file for metadata."""
    meta = PhotoMeta()
    try:
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        meta.title = data.get("title", "")
        meta.description = data.get("description", "")

        # Date taken — Takeout stores this as a Unix timestamp string
        photo_taken = data.get("photoTakenTime", {})
        if photo_taken.get("timestamp"):
            ts = int(photo_taken["timestamp"])
            meta.date_taken = datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S")

        # Geo coordinates
        geo = data.get("geoData", {}) or data.get("geoDataExif", {})
        lat = geo.get("latitude", 0)
        lon = geo.get("longitude", 0)
        if lat != 0 or lon != 0:
            meta.latitude = lat
            meta.longitude = lon

    except (json.JSONDecodeError, KeyError, ValueError, OSError) as e:
        logging.debug(f"Could not parse sidecar JSON {json_path}: {e}")

    return meta


# ── Progress Tracking ────────────────────────────────────────────────────────

@dataclass
class UploadProgress:
    """Thread-safe progress tracker with persistence to disk."""
    uploaded: dict = field(default_factory=dict)  # filepath -> flickr_photo_id
    failed: set = field(default_factory=set)       # filepaths that failed permanently
    total_files: int = 0
    total_bytes_uploaded: int = 0
    start_time: float = 0.0
    _lock: Lock = field(default_factory=Lock)
    _progress_path: str = PROGRESS_FILE

    def load(self, path: str):
        """Load progress from a JSON file."""
        self._progress_path = path
        if os.path.exists(path):
            with open(path, "r") as f:
                data = json.load(f)
            self.uploaded = data.get("uploaded", {})
            self.failed = set(data.get("failed", []))
            self.total_bytes_uploaded = data.get("total_bytes_uploaded", 0)
            logging.info(f"Resumed from progress file: {len(self.uploaded)} already uploaded, {len(self.failed)} previously failed")

    def save(self):
        """Persist progress to disk (atomic write)."""
        with self._lock:
            data = {
                "uploaded": self.uploaded,
                "failed": list(self.failed),
                "total_bytes_uploaded": self.total_bytes_uploaded,
                "last_saved": datetime.now().isoformat(),
            }
        tmp_path = self._progress_path + ".tmp"
        with open(tmp_path, "w") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp_path, self._progress_path)

    def mark_uploaded(self, filepath: str, photo_id: str, file_size: int):
        with self._lock:
            self.uploaded[filepath] = photo_id
            self.total_bytes_uploaded += file_size

    def mark_failed(self, filepath: str):
        with self._lock:
            self.failed.add(filepath)

    def is_done(self, filepath: str) -> bool:
        with self._lock:
            return filepath in self.uploaded

    @property
    def done_count(self) -> int:
        with self._lock:
            return len(self.uploaded)

    @property
    def failed_count(self) -> int:
        with self._lock:
            return len(self.failed)

    def eta_string(self) -> str:
        """Estimate time remaining based on current throughput."""
        elapsed = time.time() - self.start_time
        done = self.done_count
        if done == 0 or elapsed < 1:
            return "calculating..."
        remaining = self.total_files - done - self.failed_count
        if remaining <= 0:
            return "done"
        per_file = elapsed / done
        eta_seconds = remaining * per_file
        if eta_seconds < 60:
            return f"{int(eta_seconds)}s"
        elif eta_seconds < 3600:
            return f"{int(eta_seconds / 60)}m {int(eta_seconds % 60)}s"
        elif eta_seconds < 86400:
            hours = int(eta_seconds / 3600)
            mins = int((eta_seconds % 3600) / 60)
            return f"{hours}h {mins}m"
        else:
            days = int(eta_seconds / 86400)
            hours = int((eta_seconds % 86400) / 3600)
            return f"{days}d {hours}h"

    def size_string(self) -> str:
        """Human-readable total uploaded size."""
        with self._lock:
            b = self.total_bytes_uploaded
        if b < 1024:
            return f"{b} B"
        elif b < 1024 ** 2:
            return f"{b / 1024:.1f} KB"
        elif b < 1024 ** 3:
            return f"{b / 1024**2:.1f} MB"
        elif b < 1024 ** 4:
            return f"{b / 1024**3:.2f} GB"
        else:
            return f"{b / 1024**4:.2f} TB"


# ── File Scanner ─────────────────────────────────────────────────────────────

def scan_directory(root: str) -> list[Path]:
    """Recursively scan for uploadable photo/video files, sorted by path."""
    root_path = Path(root)
    if not root_path.exists():
        logging.error(f"Directory does not exist: {root}")
        sys.exit(1)
    if not root_path.is_dir():
        logging.error(f"Not a directory: {root}")
        sys.exit(1)

    files = []
    for dirpath, _dirnames, filenames in os.walk(root_path):
        for fname in filenames:
            ext = os.path.splitext(fname)[1].lower()
            if ext in SUPPORTED_EXTENSIONS:
                files.append(Path(dirpath) / fname)

    files.sort()
    return files


def scan_total_size(files: list[Path]) -> int:
    """Calculate total size in bytes of all files."""
    total = 0
    for f in files:
        try:
            total += f.stat().st_size
        except OSError:
            pass
    return total


# ── Flickr Upload ────────────────────────────────────────────────────────────

def queue_video_on_nas(file_path, meta, backend_url, backend_key, session):
    """Stream the full original to Kindred; conversion runs in NAS workers."""
    if not backend_url or not backend_key:
        raise ValueError('Videos require --backend-url and --backend-key for durable NAS storage')
    boundary = 'Kindred-' + uuid.uuid4().hex
    fields = {'title': meta.title or file_path.stem, 'description': meta.description or ''}
    if meta.date_taken:
        fields['taken_at_unix'] = str(int(datetime.strptime(meta.date_taken, '%Y-%m-%d %H:%M:%S').timestamp()))
    if meta.latitude is not None and meta.longitude is not None:
        fields.update(latitude=str(meta.latitude), longitude=str(meta.longitude))
    prefix = b''
    for name, value in fields.items():
        prefix += (f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n').encode()
    filename = file_path.name.replace('"', '_').replace('\r', '_').replace('\n', '_')
    prefix += (f'--{boundary}\r\nContent-Disposition: form-data; name="photo"; filename="{filename}"\r\n'
               f'Content-Type: {CONTENT_TYPES.get(file_path.suffix.lower(), "application/octet-stream")}\r\n\r\n').encode()
    suffix = f'\r\n--{boundary}--\r\n'.encode()
    def body():
        yield prefix
        with file_path.open('rb') as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                yield chunk
        yield suffix
    total_length = len(prefix) + file_path.stat().st_size + len(suffix)
    class MultipartStream:
        def __len__(self):
            return total_length

        def __iter__(self):
            return body()

    response = session.post(backend_url.rstrip('/') + '/photos/upload?privacy=family&skip_processing=true',
        data=MultipartStream(), headers={'X-API-Key': backend_key,
            'Content-Type': f'multipart/form-data; boundary={boundary}',
            'Content-Length': str(total_length)}, timeout=7200)
    response.raise_for_status()
    receipt = response.json()
    if receipt.get('nas_status') != 'available' or not receipt.get('kindred_photo_id'):
        raise ValueError('Backend did not return a durable NAS receipt')
    return receipt


def upload_to_flickr(
    file_path: Path,
    meta: PhotoMeta,
    consumer_key: str,
    consumer_secret: str,
    oauth_token: str,
    oauth_secret: str,
    session: requests.Session,
) -> str:
    """Upload a single file to Flickr. Returns the Flickr photo ID.

    Uses OAuth 1.0a signing in the Authorization header and sends
    the file as multipart/form-data, matching the backend's approach.
    """
    if file_path.suffix.lower() in VIDEO_EXTENSIONS:
        raise ValueError('Video originals must be sent through the NAS queue')
    title = meta.title or file_path.stem
    description = meta.description or ""

    # Build description with geo data if available
    if meta.date_taken and meta.date_taken not in description:
        description = f"Taken: {meta.date_taken}\n{description}".strip()

    # Parameters that go into the OAuth signature (everything EXCEPT the photo binary)
    flickr_params = {
        "title": title,
        "description": description,
        "is_public": "0",
        "is_friend": "0",
        "is_family": "1",
    }

    # Sign the request
    oauth_params = flickr_oauth_sign(
        url=UPLOAD_URL,
        params=flickr_params,
        consumer_key=consumer_key,
        consumer_secret=consumer_secret,
        oauth_token=oauth_token,
        oauth_secret=oauth_secret,
        method="POST",
    )

    auth_header = build_auth_header(oauth_params)

    # Determine content type
    ext = file_path.suffix.lower()
    content_type = CONTENT_TYPES.get(ext, "application/octet-stream")

    # Build multipart body manually (matching the backend's approach for consistent signing)
    boundary = f"Boundary-{uuid.uuid4().hex}"

    # Read file data
    file_data = file_path.read_bytes()

    body = b""
    for key, value in flickr_params.items():
        body += f"--{boundary}\r\n".encode()
        body += f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode()
        body += f"{value}\r\n".encode()
    body += f"--{boundary}\r\n".encode()
    body += f'Content-Disposition: form-data; name="photo"; filename="{file_path.name}"\r\n'.encode()
    body += f"Content-Type: {content_type}\r\n\r\n".encode()
    body += file_data
    body += f"\r\n--{boundary}--\r\n".encode()

    resp = session.post(
        UPLOAD_URL,
        data=body,
        headers={
            "Authorization": auth_header,
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        timeout=600,  # 10 minutes — large videos can take a while
    )

    if resp.status_code not in range(200, 300):
        raise RuntimeError(f"Flickr upload failed (HTTP {resp.status_code}): {resp.text[:500]}")

    # Parse photo ID from XML response: <photoid>12345</photoid>
    match = re.search(r"<photoid>(\d+)</photoid>", resp.text)
    if match:
        return match.group(1)

    # Check for error
    err_match = re.search(r'<err code="(\d+)" msg="([^"]*)"', resp.text)
    if err_match:
        raise RuntimeError(f"Flickr error {err_match.group(1)}: {err_match.group(2)}")

    raise RuntimeError(f"Could not parse Flickr response: {resp.text[:500]}")


# ── Backend Notification ─────────────────────────────────────────────────────

def notify_backend(
    photo_id: str,
    backend_url: str,
    backend_key: str,
    session: requests.Session,
) -> bool:
    """Notify the Kindred backend to process a newly uploaded photo.

    Calls POST /process-photo with the Flickr photo ID. The backend will
    fetch the photo from Flickr and run face/pet/object detection + CLIP.
    """
    if not backend_url or not backend_key:
        return False

    try:
        resp = session.post(
            f"{backend_url.rstrip('/')}/process-photo",
            json={"photo_id": photo_id},
            headers={"X-API-Key": backend_key},
            timeout=120,
        )
        if resp.status_code == 200:
            return True
        else:
            logging.debug(f"Backend process-photo returned {resp.status_code} for {photo_id}: {resp.text[:200]}")
            return False
    except requests.RequestException as e:
        logging.debug(f"Backend notification failed for {photo_id}: {e}")
        return False


# ── Single File Upload with Retry ────────────────────────────────────────────

def upload_single_file(
    file_path: Path,
    consumer_key: str,
    consumer_secret: str,
    oauth_token: str,
    oauth_secret: str,
    backend_url: str,
    backend_key: str,
    progress: UploadProgress,
    session: requests.Session,
    error_logger: logging.Logger,
    upload_delay: float,
    dry_run: bool = False,
    skip_backend: bool = False,
) -> bool:
    """Upload a single file with retry logic. Returns True on success."""
    filepath_str = str(file_path)

    if progress.is_done(filepath_str):
        return True

    # Parse metadata from sidecar JSON
    sidecar = find_sidecar_json(file_path)
    meta = parse_takeout_json(sidecar) if sidecar else PhotoMeta()
    if not meta.title:
        meta.title = file_path.stem

    file_size = file_path.stat().st_size

    if dry_run:
        progress.mark_uploaded(filepath_str, "DRY_RUN", file_size)
        return True

    last_error = None
    for attempt in range(MAX_RETRIES):
        try:
            is_video = file_path.suffix.lower() in VIDEO_EXTENSIONS
            if is_video:
                photo_id = queue_video_on_nas(file_path, meta, backend_url, backend_key, session)
            else:
                photo_id = upload_to_flickr(
                    file_path=file_path,
                    meta=meta,
                    consumer_key=consumer_key,
                    consumer_secret=consumer_secret,
                    oauth_token=oauth_token,
                    oauth_secret=oauth_secret,
                    session=session,
                )

            progress.mark_uploaded(filepath_str, photo_id, file_size)

            # Notify backend (best effort — don't fail the upload if this errors)
            if not is_video and not skip_backend and backend_url and backend_key:
                notify_backend(photo_id, backend_url, backend_key, session)

            # Rate limiting
            if upload_delay > 0:
                time.sleep(upload_delay)

            return True

        except Exception as e:
            last_error = e
            delay = RETRY_BASE_DELAY * (2 ** attempt)
            if attempt < MAX_RETRIES - 1:
                logging.warning(f"Retry {attempt + 1}/{MAX_RETRIES} for {file_path.name}: {e} (waiting {delay}s)")
                time.sleep(delay)
            else:
                error_msg = f"FAILED after {MAX_RETRIES} attempts: {file_path} — {e}"
                logging.error(error_msg)
                error_logger.error(error_msg)
                progress.mark_failed(filepath_str)

    return False


# ── Main Upload Orchestrator ─────────────────────────────────────────────────

def run_upload(args):
    """Main upload orchestration: scan, resume, upload with parallelism."""
    # Resolve progress file location
    progress_path = os.path.join(args.source_dir, PROGRESS_FILE)
    error_log_path = os.path.join(args.source_dir, ERROR_LOG)

    # Set up error logger (separate from console logging)
    error_logger = logging.getLogger("upload_errors")
    error_logger.setLevel(logging.ERROR)
    error_handler = logging.FileHandler(error_log_path, mode="a")
    error_handler.setFormatter(logging.Formatter("%(asctime)s  %(message)s"))
    error_logger.addHandler(error_handler)

    # Scan for files
    print(f"Scanning {args.source_dir} for photos and videos...")
    files = scan_directory(args.source_dir)
    total_size = scan_total_size(files)

    if not files:
        print("No supported files found.")
        return

    size_gb = total_size / (1024 ** 3)
    print(f"Found {len(files):,} files ({size_gb:.2f} GB)")

    # Load progress
    progress = UploadProgress()
    progress.load(progress_path)
    progress.total_files = len(files)
    progress.start_time = time.time()

    # Filter out already-uploaded files
    pending = [f for f in files if not progress.is_done(str(f))]
    skipped = len(files) - len(pending)
    if skipped:
        print(f"Skipping {skipped:,} already-uploaded files")

    if not pending:
        print("All files already uploaded!")
        return

    print(f"Will upload {len(pending):,} files")

    if args.dry_run:
        print("\n=== DRY RUN MODE ===")
        print("No files will actually be uploaded.\n")

        # Show first 20 files as a preview
        for i, f in enumerate(pending[:20]):
            sidecar = find_sidecar_json(f)
            meta = parse_takeout_json(sidecar) if sidecar else PhotoMeta()
            ext = f.suffix.lower()
            ftype = "VIDEO" if ext in VIDEO_EXTENSIONS else "PHOTO"
            size_mb = f.stat().st_size / (1024 ** 2)
            title = meta.title or f.stem
            date_info = f" | taken: {meta.date_taken}" if meta.date_taken else ""
            geo_info = f" | geo: {meta.latitude:.4f},{meta.longitude:.4f}" if meta.latitude else ""
            print(f"  [{ftype}] {title} ({size_mb:.1f} MB){date_info}{geo_info}")

        if len(pending) > 20:
            print(f"  ... and {len(pending) - 20:,} more files")

        # Summary by type
        photo_count = sum(1 for f in pending if f.suffix.lower() not in VIDEO_EXTENSIONS)
        video_count = sum(1 for f in pending if f.suffix.lower() in VIDEO_EXTENSIONS)
        pending_size = sum(f.stat().st_size for f in pending)
        print(f"\nSummary: {photo_count:,} photos, {video_count:,} videos, {pending_size / (1024**3):.2f} GB total")

        # Time estimate
        rate_per_sec = 0.5  # conservative: ~1 file per 2 seconds
        est_hours = len(pending) / rate_per_sec / 3600
        if args.workers > 1:
            est_hours /= min(args.workers, 5)  # parallelism helps but not linearly
        print(f"Estimated upload time: {est_hours:.1f} hours ({est_hours/24:.1f} days) with {args.workers} workers")
        return

    # Upload delay between files (per worker)
    upload_delay = args.delay

    # Graceful shutdown on Ctrl+C
    shutdown_requested = False

    def signal_handler(signum, frame):
        nonlocal shutdown_requested
        if shutdown_requested:
            print("\nForce exit — saving progress...")
            progress.save()
            sys.exit(1)
        shutdown_requested = True
        print("\nShutdown requested — finishing current uploads and saving progress...")

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    # Create a persistent session for connection pooling
    session = requests.Session()
    adapter = requests.adapters.HTTPAdapter(
        pool_connections=args.workers + 2,
        pool_maxsize=args.workers + 2,
        max_retries=0,  # we handle retries ourselves
    )
    session.mount("https://", adapter)
    session.mount("http://", adapter)

    # Progress save interval
    save_interval = 10  # save progress every 10 uploads
    last_report = [0]  # mutable for closure access
    report_interval = 100

    print(f"\nStarting upload with {args.workers} worker(s), {upload_delay}s delay between uploads...")
    print(f"Progress saved to: {progress_path}")
    print(f"Error log: {error_log_path}\n")

    def do_upload(file_path: Path) -> bool:
        if shutdown_requested:
            return False
        return upload_single_file(
            file_path=file_path,
            consumer_key=args.api_key,
            consumer_secret=args.api_secret,
            oauth_token=args.oauth_token,
            oauth_secret=args.oauth_secret,
            backend_url=args.backend,
            backend_key=args.backend_key,
            progress=progress,
            session=session,
            error_logger=error_logger,
            upload_delay=upload_delay,
            skip_backend=args.skip_backend,
        )

    try:
        if args.workers <= 1:
            # Single-threaded upload
            for i, file_path in enumerate(pending):
                if shutdown_requested:
                    break
                do_upload(file_path)
                done = progress.done_count
                if done % save_interval == 0:
                    progress.save()
                if done - last_report[0] >= report_interval:
                    last_report[0] = done
                    print(
                        f"[{done:,}/{progress.total_files:,}] "
                        f"{progress.size_string()} uploaded | "
                        f"ETA: {progress.eta_string()} | "
                        f"{progress.failed_count} errors"
                    )
        else:
            # Parallel uploads
            with ThreadPoolExecutor(max_workers=args.workers) as executor:
                futures = {}
                for file_path in pending:
                    if shutdown_requested:
                        break
                    future = executor.submit(do_upload, file_path)
                    futures[future] = file_path

                for future in as_completed(futures):
                    if shutdown_requested:
                        break
                    try:
                        future.result()
                    except Exception as e:
                        logging.error(f"Unexpected error: {e}")

                    done = progress.done_count
                    if done % save_interval == 0:
                        progress.save()
                    if done - last_report[0] >= report_interval:
                        last_report[0] = done
                        print(
                            f"[{done:,}/{progress.total_files:,}] "
                            f"{progress.size_string()} uploaded | "
                            f"ETA: {progress.eta_string()} | "
                            f"{progress.failed_count} errors"
                        )
    finally:
        progress.save()
        elapsed = time.time() - progress.start_time
        print(f"\n{'=' * 60}")
        print(f"Upload complete!")
        print(f"  Files uploaded: {progress.done_count:,}/{progress.total_files:,}")
        print(f"  Total size:     {progress.size_string()}")
        print(f"  Failures:       {progress.failed_count}")
        print(f"  Time elapsed:   {elapsed/3600:.1f} hours")
        if progress.done_count > 0:
            avg = elapsed / progress.done_count
            print(f"  Avg per file:   {avg:.1f}s")
        print(f"  Progress file:  {progress_path}")
        if progress.failed_count > 0:
            print(f"  Error log:      {error_log_path}")
        print(f"{'=' * 60}")


# ── CLI ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Bulk upload a Google Takeout photo archive to Flickr via Kindred Photos",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Basic upload
  python3 bulk-upload.py /path/to/Takeout \\
    --api-key YOUR_FLICKR_KEY --api-secret YOUR_FLICKR_SECRET \\
    --oauth-token YOUR_TOKEN --oauth-secret YOUR_TOKEN_SECRET

  # With backend notification and 5 workers
  python3 bulk-upload.py /path/to/Takeout \\
    --backend https://api.kindredphotos.app --backend-key knd_xxx \\
    --workers 5

  # Dry run to preview
  python3 bulk-upload.py /path/to/Takeout --dry-run

  # All settings via environment variables
  export FLICKR_API_KEY=xxx FLICKR_SECRET=xxx
  export FLICKR_OAUTH_TOKEN=xxx FLICKR_OAUTH_SECRET=xxx
  export KINDRED_BACKEND=https://api.kindredphotos.app KINDRED_API_KEY=knd_xxx
  python3 bulk-upload.py /path/to/Takeout
        """,
    )
    parser.add_argument("source_dir", help="Root directory of the Google Takeout archive")
    parser.add_argument("--api-key", default=os.environ.get("FLICKR_API_KEY", ""),
                        help="Flickr API consumer key (env: FLICKR_API_KEY)")
    parser.add_argument("--api-secret", default=os.environ.get("FLICKR_SECRET", ""),
                        help="Flickr API consumer secret (env: FLICKR_SECRET)")
    parser.add_argument("--oauth-token", default=os.environ.get("FLICKR_OAUTH_TOKEN", ""),
                        help="Flickr OAuth access token (env: FLICKR_OAUTH_TOKEN)")
    parser.add_argument("--oauth-secret", default=os.environ.get("FLICKR_OAUTH_SECRET", ""),
                        help="Flickr OAuth access token secret (env: FLICKR_OAUTH_SECRET)")
    parser.add_argument("--backend", default=os.environ.get("KINDRED_BACKEND", ""),
                        help="Kindred backend URL (env: KINDRED_BACKEND)")
    parser.add_argument("--backend-key", default=os.environ.get("KINDRED_API_KEY", ""),
                        help="Kindred API key for backend auth (env: KINDRED_API_KEY)")
    parser.add_argument("--workers", type=int, default=3,
                        help="Number of parallel upload workers (default: 3)")
    parser.add_argument("--delay", type=float, default=2.0,
                        help="Delay in seconds between uploads per worker (default: 2.0)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Scan and report what would be uploaded without uploading")
    parser.add_argument("--skip-backend", action="store_true",
                        help="Skip notifying the Kindred backend after uploads")
    parser.add_argument("--verbose", "-v", action="store_true",
                        help="Enable verbose/debug logging")

    args = parser.parse_args()

    # Set up logging
    log_level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(
        level=log_level,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )

    # Validate required credentials (unless dry run)
    if not args.dry_run:
        missing = []
        if not args.api_key:
            missing.append("--api-key / FLICKR_API_KEY")
        if not args.api_secret:
            missing.append("--api-secret / FLICKR_SECRET")
        if not args.oauth_token:
            missing.append("--oauth-token / FLICKR_OAUTH_TOKEN")
        if not args.oauth_secret:
            missing.append("--oauth-secret / FLICKR_OAUTH_SECRET")
        if missing:
            parser.error(f"Missing required credentials: {', '.join(missing)}")

    run_upload(args)


if __name__ == "__main__":
    main()
