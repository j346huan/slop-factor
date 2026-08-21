#!/usr/bin/env python3
"""Review one private candidate and explicitly add or update an approved record."""

from __future__ import annotations

import argparse
from pathlib import Path

from slopfactor.approval import approve


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--candidate", required=True, help="Candidate ID, including arXiv version")
    parser.add_argument("--reviewer", required=True, help="Reviewer name or accountable handle")
    parser.add_argument("--approved", type=Path, default=Path("data/approved/papers.json"))
    parser.add_argument("--work-dir", type=Path, default=Path("private/downloads"))
    parser.add_argument("--pdf", type=Path)
    parser.add_argument("--source", type=Path)
    arguments = parser.parse_args()
    try:
        record = approve(
            report_path=arguments.report,
            candidate_id=arguments.candidate,
            reviewer=arguments.reviewer,
            approved_path=arguments.approved,
            work_directory=arguments.work_dir,
            pdf_path=arguments.pdf,
            source_path=arguments.source,
        )
    except (KeyError, OSError, PermissionError, ValueError) as error:
        print(error)
        return 1
    print(f"Approved record updated: {record['arxiv_id']}v{record['version']}")
    print("Run python scripts/validate_approved.py before committing.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
