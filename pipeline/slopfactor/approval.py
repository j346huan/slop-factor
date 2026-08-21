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


def _choose(prompt: str, maximum: int, input_fn: Input) -> int:
    while True:
        value = input_fn(prompt).strip()
        if value.isdigit() and 1 <= int(value) <= maximum:
            return int(value) - 1
        print(f"Enter a number from 1 to {maximum}.")


def select_disclosure(input_fn: Input = input) -> tuple[str, float, str, str]:
    choices = [
        ("proofreading_translation", 1),
        ("brainstorming_literature_code", 2),
        ("rewriting_drafting", 5),
        ("substantial_generation", 10),
        ("mixed_or_other", None),
    ]
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
        rationale = input_fn("Required rationale for the intermediate classification: ").strip()
        while not rationale:
            rationale = input_fn("Rationale cannot be empty: ").strip()
    else:
        label = CLASSIFICATIONS[classification][1].lower()
        rationale = f"Reviewer selected the documented {label} category."
    return classification, float(multiplier), CLASSIFICATIONS[classification][1], rationale


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

    classification, multiplier, role_label, rationale = select_disclosure(input_fn)
    return {
        "quotation": quotation,
        "location": {"kind": location_kind, "value": location_value, "page": page},
        "classification": classification,
        "role_label": role_label,
        "multiplier": multiplier,
        "rationale": rationale,
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
