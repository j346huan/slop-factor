#!/usr/bin/env python3
"""Validate the production-approved dataset and recalculate every score."""

from __future__ import annotations

import argparse
from pathlib import Path

from slopfactor.validate import validate_files


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("data/approved/papers.json"))
    parser.add_argument(
        "--schema", type=Path, default=Path("data/schema/approved-paper.schema.json")
    )
    arguments = parser.parse_args()
    errors = validate_files(arguments.data, arguments.schema)
    if errors:
        print("Approved data validation failed:")
        for error in errors:
            print(f"- {error}")
        return 1
    print(f"Approved data is valid: {arguments.data}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
