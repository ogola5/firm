"""Attachment storage abstraction.

The prototype stores evidence on the local filesystem. An S3-compatible
backend can implement the same three methods later without touching routers.
"""
from __future__ import annotations

from pathlib import Path
from typing import Protocol

from app.core.config import settings


class AttachmentStorage(Protocol):
    def save(self, key: str, content: bytes) -> None: ...
    def delete(self, key: str) -> None: ...
    def local_path(self, key: str) -> Path | None: ...


class LocalAttachmentStorage:
    def __init__(self, root: Path) -> None:
        self.root = root

    def _path(self, key: str) -> Path:
        # Keys are server-generated, but never allow traversal out of the root.
        return self.root / Path(key).name

    def save(self, key: str, content: bytes) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        self._path(key).write_bytes(content)

    def delete(self, key: str) -> None:
        path = self._path(key)
        if path.exists():
            path.unlink()

    def local_path(self, key: str) -> Path | None:
        path = self._path(key)
        return path if path.is_file() else None


attachment_storage: AttachmentStorage = LocalAttachmentStorage(settings.attachment_storage_dir)
