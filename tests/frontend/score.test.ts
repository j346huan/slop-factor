import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  baseScore,
  calculateScore,
  scoreCalculation,
} from "../../src/lib/score";

const counts = {
  pages: 12,
  theorems: 3,
  lemmas: 2,
  propositions: 1,
  corollaries: 1,
  definitions: 2,
  displayed_equations: 20,
  bibliography_entries: 30,
  appendix_pages: 2,
};

describe("Slop Factor", () => {
  it("matches the canonical weighted formula", () => {
    assert.equal(baseScore(counts), 61);
    assert.equal(calculateScore(counts, 5), 305);
  });

  it("describes the record calculation", () => {
    assert.match(scoreCalculation(counts, 5), /5 × \(12 \+ 6×3/);
    assert.match(scoreCalculation(counts, 5), /30\/10/);
  });
});
