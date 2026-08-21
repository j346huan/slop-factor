"""Daily discovery orchestration. Outputs candidates, never approved records."""

from __future__ import annotations

import os
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path

from .analyze import analyze_document, extract_pdf_text
from .arxiv import ArxivClient, ArxivPaper
from .disclosure import Evidence, passages_from_text
from .download import DownloadClient
from .state import read_last_success, record_success, write_json_atomic

DEFAULT_USER_AGENT = "slop-factor/0.1 (review candidate discovery; https://github.com/)"


def metadata_evidence(paper: ArxivPaper) -> list[Evidence]:
    evidence: list[Evidence] = []
    fields = (("abstract", paper.abstract), ("comment", paper.comment), ("title", paper.title))
    for field, text in fields:
        if text:
            evidence.extend(
                passages_from_text(
                    text,
                    location_kind="metadata",
                    location_prefix=f"arXiv metadata: {field}",
                )
            )
    return evidence


def pdf_evidence(pages: list[str]) -> list[Evidence]:
    evidence: list[Evidence] = []
    for page_number, text in enumerate(pages, start=1):
        evidence.extend(
            passages_from_text(
                text,
                location_kind="page",
                location_prefix=f"PDF page {page_number}",
                page=page_number,
            )
        )
    return evidence


def date_query_bounds(scan_date: date, now: datetime) -> tuple[datetime, datetime]:
    """Return an exact UTC calendar-day window, ending at now for the current day."""
    current = now.astimezone(UTC)
    if scan_date > current.date():
        raise ValueError("Scan date cannot be in the future")
    start = datetime.combine(scan_date, time.min, tzinfo=UTC)
    end = min(start + timedelta(days=1), current)
    return start, end


def discover(
    *,
    output: Path,
    state_path: Path,
    download_directory: Path,
    max_results: int = 50,
    lookback_hours: int = 48,
    minimum_query_interval_hours: int = 6,
    now: datetime | None = None,
    include_pdf: bool = True,
    scan_date: date | None = None,
    analyze_candidates: bool = True,
) -> dict:
    """Query, conservatively match, and write a private candidate report."""
    end = (now or datetime.now(UTC)).astimezone(UTC)
    last_success = read_last_success(state_path)
    if (
        scan_date is None
        and last_success
        and end - last_success < timedelta(hours=minimum_query_interval_hours)
    ):
        report = {
            "report_version": 1,
            "generated_at": end.isoformat().replace("+00:00", "Z"),
            "skipped": True,
            "skip_reason": "A successful query was recorded within the minimum interval.",
            "query": {"last_successful_query_at": last_success.isoformat()},
            "candidates": [],
            "errors": [],
        }
        write_json_atomic(output, report)
        return report

    if scan_date is not None:
        start, end = date_query_bounds(scan_date, end)
    else:
        earliest = end - timedelta(hours=lookback_hours)
        start = max(earliest, last_success) if last_success else earliest
    user_agent = os.environ.get("ARXIV_USER_AGENT", DEFAULT_USER_AGENT)
    with ArxivClient(user_agent=user_agent) as client:
        papers = list(client.query_recent(start=start, end=end, max_results=max_results))

    if scan_date is None:
        record_success(state_path, queried_at=end, window_start=start, papers_seen=len(papers))
    candidates: list[dict] = []
    errors: list[dict] = []
    downloader = DownloadClient(user_agent=user_agent)
    download_directory.mkdir(parents=True, exist_ok=True)

    for paper in papers:
        if not paper.primary_category.startswith("math."):
            continue
        evidence = metadata_evidence(paper)
        if include_pdf:
            safe_id = paper.arxiv_id.replace("/", "-")
            pdf = download_directory / f"{safe_id}v{paper.version}.pdf"
            try:
                if not pdf.is_file():
                    downloader.download(paper.pdf_url, pdf)
                evidence.extend(pdf_evidence(extract_pdf_text(pdf)))
            except (OSError, RuntimeError, ValueError, TimeoutError) as error:
                errors.append(
                    {
                        "paper": f"{paper.arxiv_id}v{paper.version}",
                        "stage": "pdf_text",
                        "message": str(error),
                    }
                )

        unique = {(item.quotation, item.location_value): item for item in evidence}
        if unique:
            candidate = {
                "candidate_id": f"{paper.arxiv_id}v{paper.version}",
                "paper": paper.to_dict(),
                "evidence": [item.to_dict() for item in unique.values()],
                "status": "pending",
            }
            if include_pdf and analyze_candidates:
                source = download_directory / f"{safe_id}v{paper.version}.source"
                if not source.is_file():
                    try:
                        downloader.download(paper.source_url, source)
                    except (OSError, RuntimeError, ValueError, TimeoutError) as error:
                        errors.append(
                            {
                                "paper": candidate["candidate_id"],
                                "stage": "source",
                                "message": str(error),
                            }
                        )
                        source = None
                try:
                    analysis = analyze_document(pdf, source)
                    candidate["analysis"] = {
                        "structural_counts": analysis.counts,
                        "count_methods": analysis.methods,
                        "count_notes": analysis.notes,
                    }
                except (OSError, RuntimeError, ValueError) as error:
                    errors.append(
                        {
                            "paper": candidate["candidate_id"],
                            "stage": "analysis",
                            "message": str(error),
                        }
                    )
            candidates.append(candidate)

    report = {
        "report_version": 1,
        "generated_at": end.isoformat().replace("+00:00", "Z"),
        "skipped": False,
        "query": {
            "category": "math.*",
            "window_start": start.isoformat().replace("+00:00", "Z"),
            "window_end": end.isoformat().replace("+00:00", "Z"),
            "papers_seen": len(papers),
            "request_interval_seconds": 3,
            "scan_date": scan_date.isoformat() if scan_date is not None else None,
        },
        "candidates": candidates,
        "errors": errors,
    }
    write_json_atomic(output, report)
    return report
