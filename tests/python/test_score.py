from decimal import Decimal

import pytest
from slopfactor.score import calculate_score

COUNTS = {
    "pages": 12,
    "theorems": 3,
    "lemmas": 2,
    "propositions": 1,
    "corollaries": 1,
    "definitions": 2,
    "displayed_equations": 20,
    "bibliography_entries": 30,
    "appendix_pages": 2,
}


def test_calculates_exact_unbounded_score_and_breakdown() -> None:
    result = calculate_score(COUNTS, 5)

    assert result["score"] == 305
    assert result["score_breakdown"]["base_score"] == 61
    assert result["score_breakdown"]["contributions"]["displayed_equations"] == 5
    assert result["score_breakdown"]["contributions"]["bibliography_entries"] == 3


def test_accepts_intermediate_multiplier_without_normalizing() -> None:
    result = calculate_score(COUNTS, Decimal("3.5"))

    assert result["score"] == 213.5
    assert result["score_breakdown"]["multiplier"] == 3.5


@pytest.mark.parametrize("multiplier", [0, 10.1])
def test_rejects_multiplier_outside_documented_range(multiplier: float) -> None:
    with pytest.raises(ValueError, match="between 1 and 10"):
        calculate_score(COUNTS, multiplier)


def test_rejects_negative_or_noninteger_counts() -> None:
    with pytest.raises(ValueError, match="pages"):
        calculate_score({**COUNTS, "pages": -1}, 1)
    with pytest.raises(ValueError, match="lemmas"):
        calculate_score({**COUNTS, "lemmas": 1.5}, 1)  # type: ignore[dict-item]
