from slopfactor.pending import candidate_issue_body, candidate_marker


def test_private_queue_packet_contains_review_evidence_and_analysis() -> None:
    candidate = {
        "candidate_id": "9999.99999v1",
        "paper": {
            "title": "Fictional paper",
            "authors": ["A. Example"],
            "abstract_url": "https://arxiv.org/abs/9999.99999v1",
            "primary_category": "math.LO",
            "secondary_categories": [],
            "submitted": "2099-01-01T00:00:00Z",
        },
        "evidence": [
            {
                "quotation": "The fictional authors used an LLM to proofread this fixture.",
                "location_value": "PDF page 4",
            }
        ],
        "analysis": {
            "structural_counts": {
                "pages": 4,
                "theorems": 1,
                "lemmas": 0,
                "propositions": 0,
                "corollaries": 0,
                "definitions": 1,
                "displayed_equations": 3,
                "bibliography_entries": 2,
                "appendix_pages": 0,
            },
            "count_methods": {
                "pages": "pdf",
                "theorems": "source",
                "lemmas": "source",
                "propositions": "source",
                "corollaries": "source",
                "definitions": "source",
                "displayed_equations": "source",
                "bibliography_entries": "source",
                "appendix_pages": "estimated",
            },
            "count_notes": ["Fictional fixture analysis."],
        },
    }
    report = {
        "query": {
            "window_start": "2099-01-01T00:00:00Z",
            "window_end": "2099-01-02T00:00:00Z",
        }
    }

    body = candidate_issue_body(candidate, report)

    assert candidate_marker("9999.99999v1") in body
    assert "Automated matching only" in body
    assert "> The fictional authors used an LLM" in body
    assert "| Theorems | 1 | source |" in body
    assert "human reviewer" in body
