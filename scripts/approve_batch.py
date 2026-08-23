#!/usr/bin/env python3
"""Apply a human-reviewed approval batch to the public dataset in one write."""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

from slopfactor.approval import confirmed_disclosure, make_record, stored_analysis
from slopfactor.state import write_json_atomic
from slopfactor.validate import validate_collection


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--batch", type=Path, required=True)
    parser.add_argument("--approved", type=Path, default=Path("data/approved/papers.json"))
    arguments = parser.parse_args()

    batch = json.loads(arguments.batch.read_text("utf8"))
    approvals = batch.get("approvals")
    reviewer = str(batch.get("reviewer", "")).strip()
    if not isinstance(approvals, list) or not reviewer:
        raise ValueError("Batch requires an approvals list and reviewer")

    collection = json.loads(arguments.approved.read_text("utf8"))
    records = {paper["arxiv_id"]: paper for paper in collection["papers"]}
    verified_at = datetime.now(UTC)
    applied = 0
    skipped = 0

    for item in approvals:
        candidate = item["candidate"]
        candidate_id = candidate["candidate_id"]
        paper = candidate["paper"]
        if not paper["primary_category"].startswith("math."):
            raise ValueError(f"{candidate_id}: primary category is not math.*")
        analysis = stored_analysis(candidate)
        if analysis is None:
            raise ValueError(f"{candidate_id}: structural analysis is unavailable")
        disclosure = confirmed_disclosure(
            candidate,
            evidence_index=1,
            classification=item["classification"],
            multiplier=float(item["multiplier"]),
            confirmation="APPROVE",
            quotation=item["quotation"],
            location_kind=item["location_kind"],
            location_value=item["location_value"],
            page=item.get("page"),
        )
        record = make_record(
            candidate,
            disclosure,
            analysis,
            reviewer=reviewer,
            now=verified_at,
        )
        existing = records.get(paper["arxiv_id"])
        if existing == record:
            skipped += 1
            continue
        records[paper["arxiv_id"]] = record
        applied += 1

    papers = sorted(
        records.values(),
        key=lambda paper: (paper["dates"]["submitted"], paper["arxiv_id"]),
        reverse=True,
    )
    proposed = {"schema_version": 1, "papers": papers}
    schema = json.loads(
        Path("data/schema/approved-paper.schema.json").read_text("utf8")
    )
    errors = validate_collection(proposed, schema)
    if errors:
        details = "\n".join(f"- {error}" for error in errors)
        raise ValueError(f"Bulk approval failed validation:\n{details}")
    write_json_atomic(arguments.approved, proposed)
    print(json.dumps({"applied": applied, "skipped": skipped}))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
