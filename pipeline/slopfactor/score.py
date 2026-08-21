"""Canonical Slop Factor calculation shared by approval and validation."""

from __future__ import annotations

from collections.abc import Mapping
from decimal import Decimal

FORMULA_VERSION = "1.0"

WEIGHTS = {
    "pages": Decimal("1"),
    "theorems": Decimal("6"),
    "lemmas": Decimal("4"),
    "propositions": Decimal("4"),
    "corollaries": Decimal("3"),
    "definitions": Decimal("2"),
    "displayed_equations": Decimal("0.25"),
    "bibliography_entries": Decimal("0.1"),
    "appendix_pages": Decimal("2"),
}


def _json_number(value: Decimal) -> int | float:
    """Return a stable JSON-compatible number without insignificant zeroes."""
    if value == value.to_integral_value():
        return int(value)
    return float(value.normalize())


def calculate_score(counts: Mapping[str, int], multiplier: int | float | Decimal) -> dict:
    """Calculate the unbounded score and its complete weighted breakdown."""
    missing = WEIGHTS.keys() - counts.keys()
    extra = counts.keys() - WEIGHTS.keys()
    if missing or extra:
        raise ValueError(
            f"Structural count keys differ from the formula; missing={missing}, extra={extra}"
        )

    contributions: dict[str, Decimal] = {}
    for key, weight in WEIGHTS.items():
        value = counts[key]
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise ValueError(f"{key} must be a non-negative integer")
        contributions[key] = Decimal(value) * weight

    decimal_multiplier = Decimal(str(multiplier))
    if decimal_multiplier < 1 or decimal_multiplier > 10:
        raise ValueError("Disclosure multiplier must be between 1 and 10")

    base = sum(contributions.values(), Decimal("0"))
    score = base * decimal_multiplier
    return {
        "score": _json_number(score),
        "score_breakdown": {
            "formula_version": FORMULA_VERSION,
            "base_score": _json_number(base),
            "multiplier": _json_number(decimal_multiplier),
            "contributions": {key: _json_number(value) for key, value in contributions.items()},
        },
    }
