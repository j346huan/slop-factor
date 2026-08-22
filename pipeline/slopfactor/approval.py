"""Interactive, explicit approval of a private discovery candidate."""

from __future__ import annotations

import json
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

from .analyze import AnalysisResult, analyze_document
from .download import DownloadClient
from .score import calculate_score
from .state import write_json_atomic
from .validate import CLASSIFICATIONS, validate_collection

Input = Callable[[str], str]


def stored_analysis(candidate: dict) -> AnalysisResult | None:
    """Load discovery-time analysis so ChatGPT review does not repeat remote downloads."""
    payload = candidate.get("analysis")
    if payload is None:
        return None
    required = {
        "pages",
        "theorems",
        "lemmas",
        "propositions",
        "corollaries",
        "definitions",
        "displayed_equations",
        "bibliography_entries",
        "appendix_pages",
    }
    counts = payload.get("structural_counts", {})
    methods = payload.get("count_methods", {})
    if set(counts) != required or set(methods) != required:
        raise ValueError("Stored candidate analysis is incomplete")
    return AnalysisResult(
        counts=counts,
        methods=methods,
        notes=list(payload.get("count_notes", [])),
    )


def confirmed_disclosure(
    candidate: dict,
    *,
    evidence_index: int,
    classification: str,
    multiplier: float,
    confirmation: str,
    quotation: str = "",
    location_kind: str = "",
    location_value: str = "",
    page: int | None = None,
) -> dict:
    """Validate a dashboard decision and return the canonical disclosure object."""
    if confirmation != "APPROVE":
        raise PermissionError("Explicit APPROVE confirmation is required")
    if not 1 <= evidence_index <= len(candidate["evidence"]):
        raise ValueError("Evidence index is outside the candidate passage list")
    evidence = candidate["evidence"][evidence_index - 1]
    if classification not in CLASSIFICATIONS:
        raise ValueError("Unknown disclosure classification")
    expected_multiplier = CLASSIFICATIONS[classification][0]
    if expected_multiplier is not None and multiplier != expected_multiplier:
        raise ValueError("Multiplier does not match the selected disclosure classification")
    if not 1 <= multiplier <= 10:
        raise ValueError("Multiplier must be from 1 through 10")
    resolved_kind = location_kind or evidence["location_kind"]
    resolved_value = location_value or evidence["location_value"]
    resolved_page = page if page is not None else evidence.get("page")
    if resolved_kind not in {"page", "metadata"}:
        raise ValueError("Location kind must be page or metadata")
    if resolved_kind == "page" and (resolved_page is None or resolved_page < 1):
        raise ValueError("A page disclosure requires a positive PDF page number")
    if resolved_kind == "metadata":
        resolved_page = None

    return {
        "quotation": quotation or evidence["quotation"],
        "location": {"kind": resolved_kind, "value": resolved_value, "page": resolved_page},
        "classification": classification,
        "role_label": CLASSIFICATIONS[classification][1],
        "multiplier": multiplier,
    }


def _choose(prompt: str, maximum: int, input_fn: Input) -> int:
    while True:
        value = input_fn(prompt).strip()
        if value.isdigit() and 1 <= int(value) <= maximum:
            return int(value) - 1
        print(f"Enter a number from 1 to {maximum}.")


def select_disclosure(input_fn: Input = input) -> tuple[str, float, str]:
    choices = [(classification, values[0]) for classification, values in CLASSIFICATIONS.items()]
    print("\nDisclosure classification (select the highest applicable disclosed use):")
    for index, (classification, multiplier) in enumerate(choices, start=1):
        label = CLASSIFICATIONS[classification][1]
        suffix = f" (M={multiplier})" if multiplier is not None else " (reviewer-selected M)"
        print(f"  {index}. {label}{suffix}")
    selected = _choose("Classification: ", len(choices), input_fn)
    classification, multiplier = choices[selected]
    if multiplier is None:
        while True:
            raw = input_fn("Intermediate multiplier from 1 through 10: ").strip()
            try:
                multiplier = float(raw)
            except ValueError:
                print("Enter a number from 1 through 10.")
                continue
            if 1 <= multiplier <= 10:
                break
            print("Enter a number from 1 through 10.")
    return classification, float(multiplier), CLASSIFICATIONS[classification][1]


def review_candidate(candidate: dict, input_fn: Input = input) -> dict:
    paper = candidate["paper"]
    print("\nCandidate")
    print(f"  {paper['title']}")
    print(f"  {', '.join(paper['authors'])}")
    print(f"  arXiv:{paper['arxiv_id']}v{paper['version']} · {paper['primary_category']}")
    print("\nCandidate passages (a match is not an approval):")
    for index, item in enumerate(candidate["evidence"], start=1):
        print(f"\n[{index}] {item['location_value']}\n{item['quotation']}")

    if input_fn("\nType APPROVE to begin an approval for this paper: ").strip() != "APPROVE":
        raise PermissionError("Approval cancelled; no public data was changed")
    selected = _choose(
        "Passage containing the explicit author disclosure: ", len(candidate["evidence"]), input_fn
    )
    evidence = candidate["evidence"][selected]

    quotation = evidence["quotation"]
    if (
        input_fn("Use the displayed passage as the exact disclosure quotation? [y/N]: ")
        .strip()
        .lower()
        != "y"
    ):
        quotation = input_fn("Paste the exact disclosure quotation: ").strip()
    if not quotation:
        raise ValueError("The exact disclosure quotation is required")

    location_value = evidence["location_value"]
    location_kind = evidence["location_kind"]
    page = evidence.get("page")
    if input_fn(f"Confirm disclosure location '{location_value}'? [y/N]: ").strip().lower() != "y":
        location_kind = input_fn("Location kind (page or metadata): ").strip().lower()
        if location_kind not in {"page", "metadata"}:
            raise ValueError("Location kind must be page or metadata")
        location_value = input_fn("Exact location description: ").strip()
        if location_kind == "page":
            page_text = input_fn("PDF page number: ").strip()
            if not page_text.isdigit() or int(page_text) < 1:
                raise ValueError("A positive PDF page number is required")
            page = int(page_text)
        else:
            page = None
    if not location_value or (location_kind == "page" and page is None):
        raise ValueError("A confirmed disclosure location is required")

    classification, multiplier, role_label = select_disclosure(input_fn)
    return {
        "quotation": quotation,
        "location": {"kind": location_kind, "value": location_value, "page": page},
        "classification": classification,
        "role_label": role_label,
        "multiplier": multiplier,
    }


def make_record(
    candidate: dict,
    disclosure: dict,
    analysis: AnalysisResult,
    *,
    reviewer: str,
    now: datetime | None = None,
) -> dict:
    paper = candidate["paper"]
    verified_at = (now or datetime.now(UTC)).astimezone(UTC)
    calculated = calculate_score(analysis.counts, disclosure["multiplier"])
    return {
        "record_version": 1,
        "arxiv_id": paper["arxiv_id"],
        "version": paper["version"],
        "title": paper["title"],
        "authors": paper["authors"],
        "categories": {
            "primary": paper["primary_category"],
            "secondary": paper["secondary_categories"],
        },
        "dates": {
            "submitted": paper["submitted"],
            "updated": paper["updated"],
            "approved": verified_at.date().isoformat(),
        },
        "abstract": paper["abstract"],
        "urls": {
            "abstract": paper["abstract_url"],
            "pdf": paper["pdf_url"],
            "source": paper["source_url"],
        },
        "structural_counts": analysis.counts,
        "count_methods": analysis.methods,
        "count_notes": analysis.notes,
        "disclosure": disclosure,
        "verification": {
            "status": "verified",
            "reviewer": reviewer,
            "verified_at": verified_at.isoformat().replace("+00:00", "Z"),
        },
        "score": calculated["score"],
        "score_breakdown": calculated["score_breakdown"],
    }


def upsert_record(path: Path, record: dict) -> None:
    collection = (
        json.loads(path.read_text("utf8"))
        if path.is_file()
        else {"schema_version": 1, "papers": []}
    )
    papers = [item for item in collection["papers"] if item["arxiv_id"] != record["arxiv_id"]]
    papers.append(record)
    papers.sort(key=lambda item: (item["dates"]["submitted"], item["arxiv_id"]), reverse=True)
    proposed = {"schema_version": 1, "papers": papers}
    schema_path = path.parent.parent / "schema" / "approved-paper.schema.json"
    schema = json.loads(schema_path.read_text("utf8"))
    errors = validate_collection(proposed, schema)
    if errors:
        details = "\n".join(f"- {error}" for error in errors)
        raise ValueError(f"Generated record failed approved-data validation:\n{details}")
    write_json_atomic(path, proposed)


def approve(
    *,
    report_path: Path,
    candidate_id: str,
    reviewer: str,
    approved_path: Path,
    work_directory: Path,
    pdf_path: Path | None = None,
    source_path: Path | None = None,
    input_fn: Input = input,
) -> dict:
    report = json.loads(report_path.read_text("utf8"))
    candidate = next(
        (item for item in report.get("candidates", []) if item["candidate_id"] == candidate_id),
        None,
    )
    if candidate is None:
        raise KeyError(f"Candidate not found: {candidate_id}")
    if not candidate["paper"]["primary_category"].startswith("math."):
        raise ValueError("Only papers with a primary math.* category are eligible")

    disclosure = review_candidate(candidate, input_fn)
    analysis = stored_analysis(candidate)
    if analysis is None:
        work_directory.mkdir(parents=True, exist_ok=True)
        downloader = DownloadClient(user_agent="slop-factor/0.1 (local human review)")
        safe_id = candidate_id.replace("/", "-")
        if pdf_path is None:
            pdf_path = work_directory / f"{safe_id}.pdf"
            if not pdf_path.is_file():
                downloader.download(candidate["paper"]["pdf_url"], pdf_path)
        if source_path is None:
            source_path = work_directory / f"{safe_id}.source"
            if not source_path.is_file():
                try:
                    downloader.download(candidate["paper"]["source_url"], source_path)
                except (OSError, ValueError, TimeoutError) as error:
                    print(f"Source unavailable; analysis will document PDF fallback: {error}")
                    source_path = None
        analysis = analyze_document(pdf_path, source_path)
    record = make_record(candidate, disclosure, analysis, reviewer=reviewer)
    print(f"\nCalculated Slop Factor: {record['score']}")
    if input_fn("Type WRITE to update approved public data: ").strip() != "WRITE":
        raise PermissionError("Write cancelled; no public data was changed")
    upsert_record(approved_path, record)
    return record
