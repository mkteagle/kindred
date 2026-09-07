from __future__ import annotations

from hashlib import sha256
from pathlib import Path, PurePosixPath
import os
import re
import tempfile
import uuid

from .base import StoredPhoto, StorageProvider

_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")


VIDEO_EXTENSIONS = {'.mp4', '.mov', '.m4v', '.m4p', '.avi', '.wmv', '.mpeg',
                    '.mpg', '.3gp', '.m2ts', '.ogg', '.ogv', '.mkv'}


def managed_originals(root):
    """Bounded catalog fallback, including videos without counting legacy aliases."""
    seen = set()
    for pattern in ('videos/??/*/original.*', '??/*/original.*'):
        for path in Path(root).glob(pattern):
            resolved = path.resolve()
            if resolved in seen or not path.is_file():
                continue
            seen.add(resolved)
            yield path


class LocalStorageProvider(StorageProvider):
    name = "nas"

    def __init__(self, root: str | Path):
        self.root = Path(root).expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _safe_suffix(filename: str) -> str:
        suffix = Path(filename).suffix.lower()
        if not suffix or len(suffix) > 12 or not suffix[1:].isalnum():
            return ".bin"
        return suffix

    def store_file(self, photo_id: str, source: Path, filename: str) -> StoredPhoto:
        stable_id = str(uuid.UUID(photo_id))
        source = Path(source)
        digest = sha256()
        base = self.root / 'videos' if self._safe_suffix(filename) in VIDEO_EXTENSIONS else self.root
        destination_dir = base / stable_id[:2] / stable_id
        destination_dir.mkdir(parents=True, exist_ok=True)
        destination = destination_dir / f"original{self._safe_suffix(filename)}"

        fd, temporary_name = tempfile.mkstemp(prefix=".kindred-", dir=destination_dir)
        temporary = Path(temporary_name)
        try:
            with os.fdopen(fd, "wb") as output, source.open("rb") as input_file:
                while chunk := input_file.read(1024 * 1024):
                    digest.update(chunk)
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, destination)
        except Exception:
            temporary.unlink(missing_ok=True)
            raise

        relative = destination.relative_to(self.root).as_posix()
        return StoredPhoto(
            provider=self.name,
            provider_key=relative,
            byte_size=destination.stat().st_size,
            sha256=digest.hexdigest(),
            local_path=destination,
        )

    def resolve_local_path(self, provider_key: str) -> Path | None:
        key = PurePosixPath(provider_key)
        if key.is_absolute() or ".." in key.parts:
            return None
        candidate = (self.root / Path(*key.parts)).resolve()
        try:
            candidate.relative_to(self.root)
        except ValueError:
            return None
        return candidate if candidate.is_file() else None

    def delete(self, provider_key: str) -> None:
        path = self.resolve_local_path(provider_key)
        if path is None:
            return
        path.unlink()
        try:
            path.parent.rmdir()
            path.parent.parent.rmdir()
        except OSError:
            pass

    # ── Album symlink tree ───────────────────────────────────────────────
    # Albums are a browsable projection over the content-addressed tree:
    # albums/<slug>/<filename> is a relative symlink to ../../xx/uuid/original.ext.
    # Nothing is copied, so dedup holds and a photo can sit in many albums.

    ALBUM_DIR = "albums"

    def album_dir(self, slug: str) -> Path:
        if not _SLUG_RE.match(slug):
            raise ValueError(f"Unsafe album slug: {slug!r}")
        return self.root / self.ALBUM_DIR / slug

    def link_into_album(self, slug: str, provider_key: str, filename: str) -> str | None:
        """Symlink a stored original into an album directory.

        Returns the link's path relative to the storage root, or None when the
        original is missing. Idempotent: an existing link to the same target is
        reused, and a name already taken by a different photo gets a suffix.
        """
        target = self.resolve_local_path(provider_key)
        if target is None:
            return None

        directory = self.album_dir(slug)
        directory.mkdir(parents=True, exist_ok=True)

        stem = Path(filename).stem or "photo"
        suffix = self._safe_suffix(filename)
        candidate = directory / f"{stem}{suffix}"
        relative_target = os.path.relpath(target, directory)

        attempt = 1
        while True:
            if candidate.is_symlink():
                if os.readlink(candidate) == relative_target or candidate.resolve() == target:
                    return candidate.relative_to(self.root).as_posix()
            elif not candidate.exists():
                # Symlink atomically so a concurrent upload of the same name
                # loses the race cleanly instead of writing a half-made link.
                temporary = directory / f".kindred-{uuid.uuid4().hex}"
                temporary.symlink_to(relative_target)
                try:
                    os.replace(temporary, candidate)
                except OSError:
                    temporary.unlink(missing_ok=True)
                    raise
                return candidate.relative_to(self.root).as_posix()
            attempt += 1
            candidate = directory / f"{stem} ({attempt}){suffix}"

    def unlink_from_album(self, link_path: str) -> None:
        """Remove one album symlink. Never touches the original it points at."""
        key = PurePosixPath(link_path)
        if key.is_absolute() or ".." in key.parts:
            return
        candidate = self.root / Path(*key.parts)
        try:
            candidate.relative_to(self.root / self.ALBUM_DIR)
        except ValueError:
            return
        if candidate.is_symlink():
            candidate.unlink()
            try:
                candidate.parent.rmdir()
            except OSError:
                pass
