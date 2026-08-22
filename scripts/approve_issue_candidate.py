#!/usr/bin/env python3
"""Create an approved record from an explicitly confirmed private candidate issue."""

from __future__ import annotations

import argparse
import json
import os
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

from slopfactor.approval import confirmed_disclosure, make_record, stored_analysis, upsert_record
from slopfactor.pending import PENDING_LABEL, decode_candidate_argument, decode_candidate_payload


def fetch_issue(repository: str, issue_number: int, token: str) -> dict:
    request = urllib.request.Request(
        f"https://api.github.com/repos/{repository}/issues/{issue_number}",
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "slop-factor-approval/0.1",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", default=os.environ.get("GITHUB_REPOSITORY", ""))
    parser.add_argument("--token", default=os.environ.get("GITHUB_TOKEN", ""))
    parser.add_argument("--issue", type=int)
    parser.add_argument("--candidate-payload")
    parser.add_argument("--reviewer", required=True)
    parser.add_argument("--evidence-index", type=int, required=True)
    parser.add_argument("--classification", required=True)
    parser.add_argument("--multiplier", type=float, required=True)
    parser.add_argument("--quotation", default="")
    parser.add_argument("--location-kind", default="")
    parser.add_argument("--location-value", default="")
    parser.add_argument("--page", type=int)
    parser.add_argument("--confirmation", required=True)
    parser.add_argument("--approved", type=Path, default=Path("data/approved/papers.json"))
    parser.add_argument("--result", type=Path)
    arguments = parser.parse_args()

    if arguments.candidate_payload:
        candidate = decode_candidate_argument(arguments.candidate_payload)
    elif arguments.issue is not None:
        issue = fetch_issue(arguments.repository, arguments.issue, arguments.token)
        labels = {label["name"] for label in issue.get("labels", [])}
        if PENDING_LABEL not in labels:
            raise ValueError("Candidate issue is not pending human review")
        candidate = decode_candidate_payload(issue.get("body") or "")
    else:
        parser.error("--candidate-payload or --issue is required")
    if not candidate["paper"]["primary_category"].startswith("math."):
        raise ValueError("Only papers with a primary math.* category are eligible")
    analysis = stored_analysis(candidate)
    if analysis is None:
        raise ValueError("Candidate does not contain completed structural analysis")
    disclosure = confirmed_disclosure(
        candidate,
        evidence_index=arguments.evidence_index,
        classification=arguments.classification,
        multiplier=arguments.multiplier,
        confirmation=arguments.confirmation,
        quotation=arguments.quotation,
        location_kind=arguments.location_kind,
        location_value=arguments.location_value,
        page=arguments.page,
    )
    record = make_record(
        candidate,
        disclosure,
        analysis,
        reviewer=arguments.reviewer,
        now=datetime.now(UTC),
    )
    upsert_record(arguments.approved, record)
    result = {"candidate_id": candidate["candidate_id"], "score": record["score"]}
    if arguments.result is not None:
        arguments.result.parent.mkdir(parents=True, exist_ok=True)
        arguments.result.write_text(json.dumps(result) + "\n", "utf8")
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
