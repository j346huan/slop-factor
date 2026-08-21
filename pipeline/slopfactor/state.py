"""Atomic JSON state used to avoid redundant arXiv API queries."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path


def read_last_success(path: Path) -> datetime | None:
    if not path.is_file():
        return None
    data = json.loads(path.read_text("utf8"))
    value = data.get("last_successful_query_at")
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None


def write_json_atomic(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", "utf8")
    temporary.replace(path)


def record_success(
    path: Path, *, queried_at: datetime, window_start: datetime, papers_seen: int
) -> None:
    write_json_atomic(
        path,
        {
            "state_version": 1,
            "last_successful_query_at": queried_at.isoformat().replace("+00:00", "Z"),
            "last_window_start": window_start.isoformat().replace("+00:00", "Z"),
            "papers_seen": papers_seen,
        },
    )
