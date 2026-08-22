import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fixture from "../fixtures/approved-paper.json" with { type: "json" };
import {
  dailySlopSeries,
  latestPapers,
  topPapers,
  topPapersThisWeek,
  totalSlop,
} from "../../src/lib/home";
import type { ApprovedPaper } from "../../src/lib/types";

function paper(id: string, submitted: string, score: number): ApprovedPaper {
  const value = structuredClone(fixture.papers[0]) as ApprovedPaper;
  value.arxiv_id = id;
  value.title = id;
  value.dates.submitted = `${submitted}T00:00:00Z`;
  value.score = score;
  return value;
}

describe("home rankings", () => {
  const papers = [
    paper("old-high", "2026-08-01", 900),
    paper("week-low", "2026-08-18", 100),
    paper("week-high", "2026-08-21", 500),
  ];

  it("sorts latest and all-time lists independently", () => {
    assert.deepEqual(
      latestPapers(papers).map((item) => item.arxiv_id),
      ["week-high", "week-low", "old-high"],
    );
    assert.deepEqual(
      topPapers(papers).map((item) => item.arxiv_id),
      ["old-high", "week-high", "week-low"],
    );
  });

  it("limits the weekly ranking to the last seven calendar days", () => {
    assert.deepEqual(
      topPapersThisWeek(papers, "2026-08-22").map((item) => item.arxiv_id),
      ["week-high", "week-low"],
    );
  });

  it("sums the Slop Factor of every approved paper", () => {
    assert.equal(totalSlop(papers), 1500);
    assert.equal(totalSlop([]), 0);
  });

  it("returns one daily total for every date in the requested range", () => {
    assert.deepEqual(
      dailySlopSeries(
        [
          paper("one", "2026-08-20", 100),
          paper("two", "2026-08-20", 50),
          paper("three", "2026-08-22", 25),
        ],
        "2026-08-22",
      ),
      [
        { date: "2026-08-20", total: 150 },
        { date: "2026-08-21", total: 0 },
        { date: "2026-08-22", total: 25 },
      ],
    );
  });
});
