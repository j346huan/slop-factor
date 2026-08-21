from slopfactor.disclosure import passages_from_text, probable_disclosure


def test_accepts_explicit_author_use_statement() -> None:
    passage = (
        "We used ChatGPT to proofread the English text after completing the mathematical work."
    )
    assert probable_disclosure(passage)


def test_rejects_general_discussion_and_references() -> None:
    assert not probable_disclosure(
        "We study how large language models are used in automated reasoning."
    )
    assert not probable_disclosure(
        "[12] A. Researcher. ChatGPT and theorem proving. Example Press, 2024."
    )
    assert not probable_disclosure("No AI tools or LLMs were used in preparing this paper.")


def test_extracts_location_without_treating_every_term_as_candidate() -> None:
    text = (
        "Large language models are increasingly discussed in mathematics. "
        "For preparation of this manuscript, the authors used Claude to translate two paragraphs."
    )
    evidence = passages_from_text(
        text,
        location_kind="page",
        location_prefix="PDF page 8",
        page=8,
    )

    assert len(evidence) == 1
    assert evidence[0].page == 8
    assert evidence[0].location_value == "PDF page 8"
