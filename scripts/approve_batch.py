#!/usr/bin/env python3
"""Merge a validated batch of final public records into the approved dataset."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from slopfactor.state import write_json_atomic
from slopfactor.validate import validate_collection


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--batch", type=Path, required=True)
    parser.add_argument("--approved", type=Path, default=Path("data/approved/papers.json"))
    arguments = parser.parse_args()

    batch = json.loads(arguments.batch.read_text("utf8"))
    incoming = batch.get("records")
    if not isinstance(incoming, list) or not incoming:
        raise ValueError("Batch requires a non-empty records list")

    collection = json.loads(arguments.approved.read_text("utf8"))
    records = {paper["arxiv_id"]: paper for paper in collection["papers"]}
    for record in incoming:
        records[record["arxiv_id"]] = record

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
    print(json.dumps({"applied": len(incoming)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
