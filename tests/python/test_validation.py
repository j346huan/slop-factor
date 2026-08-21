import copy
import json
from pathlib import Path

from slopfactor.validate import validate_collection


def _load(path: str) -> dict:
    return json.loads(Path(path).read_text("utf8"))


def test_fictional_fixture_is_valid() -> None:
    collection = _load("tests/fixtures/approved-paper.json")
    schema = _load("data/schema/approved-paper.schema.json")

    assert validate_collection(collection, schema) == []


def test_rejects_unverified_record_before_semantic_checks() -> None:
    collection = _load("tests/fixtures/approved-paper.json")
    schema = _load("data/schema/approved-paper.schema.json")
    collection["papers"][0]["verification"]["status"] = "pending"

    errors = validate_collection(collection, schema)

    assert any("verified" in error for error in errors)


def test_recalculates_score_and_every_contribution() -> None:
    collection = _load("tests/fixtures/approved-paper.json")
    schema = _load("data/schema/approved-paper.schema.json")
    changed = copy.deepcopy(collection)
    changed["papers"][0]["score"] = 1
    changed["papers"][0]["score_breakdown"]["contributions"]["theorems"] = 1

    errors = validate_collection(changed, schema)

    assert any("stored score" in error for error in errors)
    assert any("contribution theorems" in error for error in errors)
