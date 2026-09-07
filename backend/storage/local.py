from __future__ import annotations

from hashlib import sha256
from pathlib import Path, PurePosixPath
import os
import tempfile
import uuid

from .base import StoredPhoto, StorageProvider


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
        destination_dir = self.root / stable_id[:2] / stable_id
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
