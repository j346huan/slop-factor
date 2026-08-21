import pytest
from slopfactor.approval import review_candidate

CANDIDATE = {
    "candidate_id": "9999.99999v1",
    "paper": {
        "title": "Fictional paper",
        "authors": ["A. Example"],
        "arxiv_id": "9999.99999",
        "version": 1,
        "primary_category": "math.LO",
    },
    "evidence": [
        {
            "quotation": "The fictional authors used ChatGPT to proofread this fictional fixture.",
            "location_kind": "page",
            "location_value": "PDF page 2",
            "page": 2,
        }
    ],
}


def test_does_not_approve_without_exact_confirmation() -> None:
    answers = iter(["yes"])

    with pytest.raises(PermissionError, match="no public data was changed"):
        review_candidate(CANDIDATE, lambda _prompt: next(answers))


def test_requires_passage_location_and_classification_choices() -> None:
    answers = iter(["APPROVE", "1", "y", "y", "1"])

    disclosure = review_candidate(CANDIDATE, lambda _prompt: next(answers))

    assert disclosure["quotation"].startswith("The fictional authors")
    assert disclosure["location"]["page"] == 2
    assert disclosure["classification"] == "proofreading_translation"
    assert disclosure["multiplier"] == 1
