from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class StoredPhoto:
    provider: str
    provider_key: str
    byte_size: int
    sha256: str
    local_path: Path | None = None
    remote_url: str | None = None


class StorageProvider(ABC):
    name: str

    @abstractmethod
    def store_file(self, photo_id: str, source: Path, filename: str) -> StoredPhoto:
        """Persist a file and return its provider-specific identity."""

    @abstractmethod
    def resolve_local_path(self, provider_key: str) -> Path | None:
        """Return a readable local path when the provider has one."""

    @abstractmethod
    def delete(self, provider_key: str) -> None:
        """Delete one provider copy. Cross-provider deletion is never implicit."""
