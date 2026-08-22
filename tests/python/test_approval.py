import base64
import json

import pytest
from slopfactor.approval import confirmed_disclosure, review_candidate, stored_analysis
from slopfactor.pending import decode_candidate_argument

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
    assert disclosure["classification"] == "proofreading_grammar"
    assert disclosure["multiplier"] == 1


def test_loads_complete_discovery_time_analysis() -> None:
    fields = {
        "pages": 4,
        "theorems": 1,
        "lemmas": 0,
        "propositions": 0,
        "corollaries": 0,
        "definitions": 1,
        "displayed_equations": 3,
        "bibliography_entries": 2,
        "appendix_pages": 0,
    }
    candidate = {
        **CANDIDATE,
        "analysis": {
            "structural_counts": fields,
            "count_methods": dict.fromkeys(fields, "source"),
            "count_notes": ["Fictional fixture."],
        },
    }

    analysis = stored_analysis(candidate)

    assert analysis is not None
    assert analysis.counts["theorems"] == 1
    assert analysis.notes == ["Fictional fixture."]


def test_dashboard_decision_requires_exact_confirmation() -> None:
    with pytest.raises(PermissionError, match="APPROVE"):
        confirmed_disclosure(
            CANDIDATE,
            evidence_index=1,
            classification="proofreading_grammar",
            multiplier=1,
            rationale="Confirmed proofreading disclosure.",
            confirmation="yes",
        )

    disclosure = confirmed_disclosure(
        CANDIDATE,
        evidence_index=1,
        classification="proofreading_grammar",
        multiplier=1,
        rationale="Confirmed proofreading disclosure.",
        confirmation="APPROVE",
    )
    assert disclosure["location"]["page"] == 2
    assert disclosure["multiplier"] == 1


def test_decodes_cross_repository_candidate_payload() -> None:
    encoded = base64.urlsafe_b64encode(json.dumps(CANDIDATE).encode()).decode().rstrip("=")

    assert decode_candidate_argument(encoded) == CANDIDATE
