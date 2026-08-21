#!/usr/bin/env python3
"""Discover private review candidates from recent official arXiv API records."""

from __future__ import annotations

import argparse
from pathlib import Path

from slopfactor.discovery import discover


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--state", type=Path, default=Path("private/state/last-query.json"))
    parser.add_argument("--downloads", type=Path, default=Path("private/downloads"))
    parser.add_argument("--max-results", type=int, default=50)
    parser.add_argument("--lookback-hours", type=int, default=48)
    parser.add_argument("--minimum-query-interval-hours", type=int, default=6)
    parser.add_argument(
        "--skip-pdf", action="store_true", help="Search metadata only (local diagnostics)"
    )
    arguments = parser.parse_args()
    report = discover(
        output=arguments.output,
        state_path=arguments.state,
        download_directory=arguments.downloads,
        max_results=arguments.max_results,
        lookback_hours=arguments.lookback_hours,
        minimum_query_interval_hours=arguments.minimum_query_interval_hours,
        include_pdf=not arguments.skip_pdf,
    )
    print(
        f"Candidate report written to {arguments.output}: "
        f"{len(report['candidates'])} candidate(s), {len(report['errors'])} retrieval error(s)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
