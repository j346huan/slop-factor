"""Conservative candidate matching for explicit author disclosures."""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass

MODEL_TERM = (
    r"(?:ChatGPT|Claude|Gemini|large[ -]language model(?:s)?|LLM(?:s)?|generative AI|"
    r"GPT-?[2345](?:\.\d+)?)"
)
TERM_PATTERN = re.compile(rf"\b{MODEL_TERM}\b", re.IGNORECASE)
AUTHOR_USE_PATTERN = re.compile(
    r"(?:"
    r"\b(?:we|the authors?|this manuscript|this paper)\b.{0,110}\b"
    r"(?:used|use|employed|utilized|relied on|asked|received|was "
    r"(?:proofread|edited|translated|drafted|revised|generated))\b"
    r"|\b(?:was|were|has been)\b.{0,45}\b"
    r"(?:generated|drafted|rewritten|revised|translated|proofread|edited|assisted)\b"
    r"|\b(?:with|using|through)\b.{0,30}\b(?:the )?(?:assistance|help|support|use)\b"
    r"|\b(?:assisted|helped)\b.{0,60}\b(?:us|the authors?)\b"
    r")",
    re.IGNORECASE | re.DOTALL,
)
USE_NEAR_TERM_PATTERN = re.compile(
    rf"(?:used|employed|utilized|assisted|helped|proofread|edited|translated|rewrote|drafted|generated)"
    rf".{{0,100}}{MODEL_TERM}|{MODEL_TERM}.{{0,100}}"
    rf"(?:was used|were used|assisted|helped|proofread|edited|translated|"
    rf"rewrote|drafted|generated)",
    re.IGNORECASE | re.DOTALL,
)
NEGATED_USE = re.compile(
    r"\b(?:not|never|no)\b.{0,35}\b(?:used|use|assistance|generated|AI tools?|LLM(?:s)?)\b",
    re.IGNORECASE,
)
REFERENCE_LIKE = re.compile(
    r"^\s*(?:\[\d+\]|\d+\.|\\bibitem)|\bet al\.\b.{0,60}\b(?:19|20)\d{2}\b",
    re.IGNORECASE,
)
GENERAL_DISCUSSION = re.compile(
    r"\b(?:we (?:study|analy[sz]e|investigate|evaluate)|this paper (?:studies|examines)|"
    r"large language models? (?:are|can|have)|recent (?:work|research|studies))\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Evidence:
    term: str
    quotation: str
    location_kind: str
    location_value: str
    page: int | None = None

    def to_dict(self) -> dict:
        return asdict(self)


def probable_disclosure(passage: str) -> bool:
    """Return true only when a term appears with a plausible author-use statement."""
    compact = " ".join(passage.split())
    if not TERM_PATTERN.search(compact):
        return False
    if NEGATED_USE.search(compact) or REFERENCE_LIKE.search(compact):
        return False
    positive = bool(AUTHOR_USE_PATTERN.search(compact) or USE_NEAR_TERM_PATTERN.search(compact))
    if not positive:
        return False
    return not (
        GENERAL_DISCUSSION.search(compact)
        and not re.search(
            r"\b(?:we|the authors?)\s+(?:also\s+)?"
            r"(?:used|use|employed|utilized|asked|received)\b"
            r"|\b(?:this manuscript|this paper)\b.{0,50}\b"
            r"(?:was|has been)\s+(?:proofread|edited|translated|drafted|generated)\b",
            compact,
            re.IGNORECASE,
        )
    )


def passages_from_text(
    text: str,
    *,
    location_kind: str,
    location_prefix: str,
    page: int | None = None,
    radius: int = 240,
) -> list[Evidence]:
    """Return deduplicated disclosure-like passages around recognized terms."""
    normalized = text.replace("\x00", " ")
    evidence: list[Evidence] = []
    seen: set[str] = set()
    for match in TERM_PATTERN.finditer(normalized):
        start = max(0, match.start() - radius)
        end = min(len(normalized), match.end() + radius)
        passage = " ".join(normalized[start:end].split())
        if passage in seen or not probable_disclosure(passage):
            continue
        seen.add(passage)
        evidence.append(
            Evidence(
                term=match.group(0),
                quotation=passage,
                location_kind=location_kind,
                location_value=location_prefix,
                page=page,
            )
        )
    return evidence
