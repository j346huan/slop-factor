import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  filterAndSortPapers,
  type FilterablePaper,
  type PaperFilters,
} from "../../src/lib/paperTable";

const papers: FilterablePaper[] = [
  {
    id: "one",
    search: "Fictional topology Ada Example",
    author: "Ada Example",
    category: "math.GT",
    classification: "proofreading_translation",
    submitted: "2099-01-01",
    score: 10,
    pages: 8,
    lemmas: 1,
    theorems: 2,
  },
  {
    id: "two",
    search: "Fictional logic Benoit Example",
    author: "Benoit Example",
    category: "math.LO",
    classification: "rewriting_drafting",
    submitted: "2099-02-01",
    score: 40,
    pages: 12,
    lemmas: 4,
    theorems: 1,
  },
];

const defaults: PaperFilters = {
  query: "",
  author: "",
  category: "",
  classification: "",
  dateFrom: "",
  dateTo: "",
  scoreMin: null,
  scoreMax: null,
  sort: "score-desc",
};

describe("paper table", () => {
  it("combines text, role, date, and score filters", () => {
    const result = filterAndSortPapers(papers, {
      ...defaults,
      query: "logic",
      classification: "rewriting_drafting",
      dateFrom: "2099-01-15",
      scoreMin: 30,
    });

    assert.deepEqual(
      result.map((paper) => paper.id),
      ["two"],
    );
  });

  it("sorts every supported numeric field and dates", () => {
    assert.equal(
      filterAndSortPapers(papers, { ...defaults, sort: "pages-asc" })[0].id,
      "one",
    );
    assert.equal(
      filterAndSortPapers(papers, { ...defaults, sort: "lemmas-desc" })[0].id,
      "two",
    );
    assert.equal(
      filterAndSortPapers(papers, { ...defaults, sort: "theorems-desc" })[0].id,
      "one",
    );
    assert.equal(
      filterAndSortPapers(papers, { ...defaults, sort: "submitted-desc" })[0]
        .id,
      "two",
    );
  });
});
