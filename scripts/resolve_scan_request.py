#!/usr/bin/env python3
"""Resolve validated scan parameters for the private administrator workflow."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from slopfactor.admin import resolve_scan_parameters


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--event-name", required=True)
    parser.add_argument("--manual-date", default="")
    parser.add_argument("--issue-title", default="")
    parser.add_argument("--max-results", default="50")
    parser.add_argument("--output", type=Path, default=os.environ.get("GITHUB_OUTPUT"))
    arguments = parser.parse_args()
    parameters = resolve_scan_parameters(
        event_name=arguments.event_name,
        manual_date=arguments.manual_date,
        issue_title=arguments.issue_title,
        max_results=arguments.max_results,
    )
    values = [
        f"scan_date={parameters.scan_date.isoformat() if parameters.scan_date else ''}",
        f"max_results={parameters.max_results}",
    ]
    if arguments.output:
        with arguments.output.open("a", encoding="utf8") as output:
            output.write("\n".join(values) + "\n")
    else:
        print("\n".join(values))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
