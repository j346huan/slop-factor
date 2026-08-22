"""Strict schema and semantic validation for approved public records."""

from __future__ import annotations

import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

from .score import calculate_score

CLASSIFICATIONS = {
    "proofreading_grammar": (1, "Proofreading, grammar, or spelling"),
    "translation": (1, "Translation"),
    "formatting_typesetting": (1, "Formatting or typesetting"),
    "literature_search": (2, "Literature search"),
    "citation_assistance": (2, "Citation assistance"),
    "brainstorming_outlining": (2, "Brainstorming or outlining"),
    "code_assistance": (2, "Code generation, completion, or debugging"),
    "computational_support": (3, "Computational experiments or data processing"),
    "rewriting_existing_text": (4, "Rewriting existing author-written text"),
    "limited_text_drafting": (5, "Drafting limited passages"),
    "mathematical_examples_conjectures": (
        6,
        "Suggesting mathematical examples or conjectures",
    ),
    "substantial_text_generation": (7, "Substantial text generation"),
    "proof_ideas_steps": (8, "Proof ideas or individual proof-step assistance"),
    "complete_proof_drafting": (9, "Drafting a complete proof for author revision"),
    "substantial_proof_generation": (10, "Substantial proof generation"),
    "substantial_mathematical_content": (
        10,
        "Substantial mathematical content or result generation",
    ),
    "mixed_or_other": (
        None,
        "Mixed or intermediate disclosed use",
    ),
}


def _same_number(left: int | float, right: int | float) -> bool:
    return abs(float(left) - float(right)) < 1e-9


def validate_collection(collection: dict, schema: dict) -> list[str]:
    errors = [
        f"{'.'.join(map(str, error.absolute_path)) or '<root>'}: {error.message}"
        for error in sorted(
            Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(collection),
            key=lambda item: list(item.absolute_path),
        )
    ]
    if errors or not isinstance(collection.get("papers"), list):
        return errors

    seen: set[tuple[str, int]] = set()
    for index, paper in enumerate(collection["papers"]):
        label = f"papers.{index} ({paper['arxiv_id']}v{paper['version']})"
        key = (paper["arxiv_id"], paper["version"])
        if key in seen:
            errors.append(f"{label}: duplicate arXiv identifier and version")
        seen.add(key)
        if not paper["categories"]["primary"].startswith("math."):
            errors.append(f"{label}: primary category is not math.*")
        if paper["categories"]["primary"] in paper["categories"]["secondary"]:
            errors.append(f"{label}: primary category is repeated as secondary")

        disclosure = paper["disclosure"]
        expected_multiplier, expected_label = CLASSIFICATIONS[disclosure["classification"]]
        if expected_multiplier is not None and not _same_number(
            disclosure["multiplier"], expected_multiplier
        ):
            errors.append(
                f"{label}: multiplier does not match disclosure classification "
                f"({disclosure['multiplier']} != {expected_multiplier})"
            )
        if disclosure["role_label"] != expected_label:
            errors.append(f"{label}: role_label does not match the classification")
        location = disclosure["location"]
        if location["kind"] == "page" and location["page"] is None:
            errors.append(f"{label}: a page disclosure requires a page number")
        if location["kind"] == "metadata" and location["page"] is not None:
            errors.append(f"{label}: metadata disclosure cannot have a page number")
        if location["page"] is not None and location["page"] > paper["structural_counts"]["pages"]:
            errors.append(f"{label}: disclosure page exceeds the PDF page count")
        if paper["structural_counts"]["appendix_pages"] > paper["structural_counts"]["pages"]:
            errors.append(f"{label}: appendix pages exceed total pages")
        if paper["dates"]["updated"] < paper["dates"]["submitted"]:
            errors.append(f"{label}: updated date precedes submitted date")

        expected = calculate_score(paper["structural_counts"], disclosure["multiplier"])
        if not _same_number(paper["score"], expected["score"]):
            errors.append(f"{label}: stored score does not match the formula")
        actual_breakdown = paper["score_breakdown"]
        expected_breakdown = expected["score_breakdown"]
        if actual_breakdown["formula_version"] != expected_breakdown["formula_version"]:
            errors.append(f"{label}: unsupported formula version")
        if not _same_number(actual_breakdown["base_score"], expected_breakdown["base_score"]):
            errors.append(f"{label}: base score is incorrect")
        if not _same_number(actual_breakdown["multiplier"], expected_breakdown["multiplier"]):
            errors.append(f"{label}: breakdown multiplier is incorrect")
        for name, value in expected_breakdown["contributions"].items():
            if not _same_number(actual_breakdown["contributions"][name], value):
                errors.append(f"{label}: contribution {name} is incorrect")

        versioned_id = f"{paper['arxiv_id']}v{paper['version']}"
        if versioned_id not in paper["urls"]["abstract"]:
            errors.append(f"{label}: abstract URL does not identify the stored version")
        if versioned_id not in paper["urls"]["pdf"]:
            errors.append(f"{label}: PDF URL does not identify the stored version")
        if versioned_id not in paper["urls"]["source"]:
            errors.append(f"{label}: source URL does not identify the stored version")
    return errors


def validate_files(data_path: Path, schema_path: Path) -> list[str]:
    try:
        collection = json.loads(data_path.read_text("utf8"))
    except (OSError, json.JSONDecodeError) as error:
        return [f"Could not read {data_path}: {error}"]
    try:
        schema = json.loads(schema_path.read_text("utf8"))
    except (OSError, json.JSONDecodeError) as error:
        return [f"Could not read {schema_path}: {error}"]
    return validate_collection(collection, schema)
