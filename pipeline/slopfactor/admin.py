"""Validation helpers for administrator scan requests."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date

SCAN_REQUEST = re.compile(r"^Scan request: (\d{4}-\d{2}-\d{2})$")


@dataclass(frozen=True)
class ScanParameters:
    scan_date: date | None
    max_results: int


def resolve_scan_parameters(
    *,
    event_name: str,
    manual_date: str = "",
    issue_title: str = "",
    max_results: str = "50",
    today: date | None = None,
) -> ScanParameters:
    """Resolve and validate scheduled, manual, or private issue scan inputs."""
    current_date = today or date.today()
    raw_date = manual_date.strip()
    if event_name == "issues":
        match = SCAN_REQUEST.fullmatch(issue_title.strip())
        if match is None:
            raise ValueError("Issue title must be 'Scan request: YYYY-MM-DD'")
        raw_date = match.group(1)
    elif event_name not in {"schedule", "workflow_dispatch"}:
        raise ValueError(f"Unsupported scan event: {event_name}")

    scan_date = date.fromisoformat(raw_date) if raw_date else None
    if scan_date is not None and scan_date > current_date:
        raise ValueError("Scan date cannot be in the future")
    try:
        limit = int(max_results)
    except ValueError as error:
        raise ValueError("Maximum results must be an integer") from error
    if not 1 <= limit <= 500:
        raise ValueError("Maximum results must be from 1 through 500")
    return ScanParameters(scan_date=scan_date, max_results=limit)
