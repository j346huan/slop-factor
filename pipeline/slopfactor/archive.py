"""Safe handling of arXiv source archives."""

from __future__ import annotations

import gzip
import shutil
import tarfile
from contextlib import suppress
from pathlib import Path

MAX_FILES = 5_000
MAX_MEMBER_BYTES = 25 * 1024 * 1024
MAX_TOTAL_BYTES = 150 * 1024 * 1024


class UnsafeArchiveError(ValueError):
    """Raised when an archive could write outside the extraction root or exceed limits."""


def _safe_target(destination: Path, name: str) -> Path:
    if not name or Path(name).is_absolute():
        raise UnsafeArchiveError(f"Unsafe archive path: {name!r}")
    target = (destination / name).resolve()
    root = destination.resolve()
    if target != root and root not in target.parents:
        raise UnsafeArchiveError(f"Archive path escapes extraction root: {name!r}")
    return target


def safe_extract_tar(archive: Path, destination: Path) -> None:
    """Extract regular files only after validating every member and aggregate size."""
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive, mode="r:*") as source:
        members = source.getmembers()
        if len(members) > MAX_FILES:
            raise UnsafeArchiveError(f"Archive contains more than {MAX_FILES} entries")
        total = 0
        checked: list[tuple[tarfile.TarInfo, Path]] = []
        for member in members:
            target = _safe_target(destination, member.name)
            if member.isdir():
                checked.append((member, target))
                continue
            if not member.isfile():
                raise UnsafeArchiveError(f"Archive member is not a regular file: {member.name!r}")
            if member.size > MAX_MEMBER_BYTES:
                raise UnsafeArchiveError(f"Archive member exceeds size limit: {member.name!r}")
            total += member.size
            if total > MAX_TOTAL_BYTES:
                raise UnsafeArchiveError("Archive exceeds total uncompressed size limit")
            checked.append((member, target))

        for member, target in checked:
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            stream = source.extractfile(member)
            if stream is None:
                raise UnsafeArchiveError(f"Could not read archive member: {member.name!r}")
            with stream, target.open("wb") as output:
                shutil.copyfileobj(stream, output, length=1024 * 1024)


def extract_source(archive: Path, destination: Path) -> None:
    """Extract a tar archive, gzipped single TeX file, or plain TeX source."""
    destination.mkdir(parents=True, exist_ok=True)
    if tarfile.is_tarfile(archive):
        safe_extract_tar(archive, destination)
        return

    raw = archive.read_bytes()
    with suppress(gzip.BadGzipFile, OSError):
        raw = gzip.decompress(raw)
    if b"\\document" not in raw and b"\\begin" not in raw:
        raise ValueError("Downloaded source is neither a safe tar archive nor recognizable TeX")
    if len(raw) > MAX_MEMBER_BYTES:
        raise UnsafeArchiveError("Single-file source exceeds size limit")
    (destination / "main.tex").write_bytes(raw)
