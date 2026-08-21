import io
import tarfile
from pathlib import Path

import pytest
from slopfactor.archive import UnsafeArchiveError, safe_extract_tar


def _archive(path: Path, name: str, content: bytes = b"test") -> None:
    with tarfile.open(path, "w:gz") as output:
        info = tarfile.TarInfo(name)
        info.size = len(content)
        output.addfile(info, io.BytesIO(content))


def test_extracts_regular_file_inside_root(tmp_path: Path) -> None:
    archive = tmp_path / "source.tar.gz"
    destination = tmp_path / "out"
    _archive(archive, "paper/main.tex", b"\\documentclass{article}")

    safe_extract_tar(archive, destination)

    assert (destination / "paper/main.tex").read_bytes() == b"\\documentclass{article}"


@pytest.mark.parametrize("name", ["../outside.tex", "/absolute.tex"])
def test_rejects_path_traversal(tmp_path: Path, name: str) -> None:
    archive = tmp_path / "unsafe.tar.gz"
    _archive(archive, name)

    with pytest.raises(UnsafeArchiveError):
        safe_extract_tar(archive, tmp_path / "out")


def test_rejects_links(tmp_path: Path) -> None:
    archive = tmp_path / "link.tar.gz"
    with tarfile.open(archive, "w:gz") as output:
        info = tarfile.TarInfo("linked.tex")
        info.type = tarfile.SYMTYPE
        info.linkname = "../outside.tex"
        output.addfile(info)

    with pytest.raises(UnsafeArchiveError, match="not a regular file"):
        safe_extract_tar(archive, tmp_path / "out")
