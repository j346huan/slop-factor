#!/usr/bin/env python3
"""Synchronize a candidate report into a private GitHub issue review queue."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from slopfactor.pending import GitHubIssueClient


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", default=os.environ.get("GITHUB_REPOSITORY", ""))
    parser.add_argument("--token", default=os.environ.get("GITHUB_TOKEN", ""))
    parser.add_argument("--report", type=Path)
    parser.add_argument("--check-private", action="store_true")
    arguments = parser.parse_args()

    client = GitHubIssueClient(repository=arguments.repository, token=arguments.token)
    client.assert_private()
    if arguments.check_private:
        print("Private administrator repository confirmed.")
        return 0
    if arguments.report is None:
        parser.error("--report is required unless --check-private is used")

    report = json.loads(arguments.report.read_text("utf8"))
    result = client.sync_report(report)
    print(
        f"Pending queue synchronized: {result.created} added, {result.updated} refreshed, "
        f"{result.unchanged} unchanged."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
