import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  approvalRequestComment,
  approvalRequestFromComments,
  countsAsCompletedScan,
  latestDateFromFeed,
  latestDateFromListing,
  mergeApprovedRecords,
  prepareApprovalBatch,
} from "../../admin-worker/src/index.ts";

describe("administrator arXiv availability", () => {
  it("reads the official announcement date from the first feed entry", () => {
    const atom = `<?xml version="1.0" encoding="UTF-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <updated>2026-08-22T05:00:00Z</updated>
        <entry>
          <id>oai:arXiv.org:2608.00001v1</id>
          <published>2026-08-21T00:00:00-04:00</published>
        </entry>
      </feed>`;

    assert.equal(latestDateFromFeed(atom), "2026-08-21");
  });

  it("rejects an empty feed instead of inventing a date", () => {
    assert.throws(
      () => latestDateFromFeed("<feed><updated>2026-08-22</updated></feed>"),
      /no mathematics papers/,
    );
  });

  it("reads the release date from the current arXiv listing", () => {
    assert.equal(
      latestDateFromListing(
        "<h3>Showing new listings for Friday, 21 August 2026</h3>",
      ),
      "2026-08-21",
    );
  });

  it("does not mark an empty or incomplete run as scanned", () => {
    const complete = {
      version: 1,
      session_id: "scan",
      status: "completed",
      stage: "Complete",
      start_date: "2026-08-21",
      end_date: "2026-08-21",
      total: 180,
      processed: 180,
      candidates: 14,
      errors: 0,
      current: "",
      created_at: "2026-08-22T00:00:00Z",
      updated_at: "2026-08-22T00:10:00Z",
    } as const;
    assert.equal(countsAsCompletedScan(complete), true);
    assert.equal(
      countsAsCompletedScan({ ...complete, total: 0, processed: 0 }),
      false,
    );
    assert.equal(countsAsCompletedScan({ ...complete, errors: 1 }), false);
  });
});

describe("approval publication", () => {
  it("merges a bulk approval directly into the public collection", () => {
    const existing = {
      schema_version: 1,
      papers: [{ arxiv_id: "2608.00001", version: 1 }],
    };
    const replacement = {
      arxiv_id: "2608.00001",
      version: 2,
      dates: { submitted: "2026-08-02" },
    };
    const added = {
      arxiv_id: "2608.00002",
      version: 1,
      dates: { submitted: "2026-08-03" },
    };
    assert.deepEqual(mergeApprovedRecords(existing, [replacement, added]), {
      schema_version: 1,
      papers: [added, replacement],
    });
  });

  it("stores everything required to retry an approval", () => {
    const approval = {
      candidatePayload: "candidate",
      reviewer: "reviewer",
      evidenceIndex: "1",
      classification: "proofreading_grammar",
      multiplier: "1",
      quotation: "The authors used ChatGPT for proofreading.",
      locationKind: "page",
      locationValue: "PDF page 7",
      page: "7",
    };
    const comment = approvalRequestComment(approval);
    assert.deepEqual(
      approvalRequestFromComments([{ body: "older" }, { body: comment }]),
      approval,
    );
  });

  it("runs different candidates independently and retries write conflicts", () => {
    const workflow = readFileSync(
      ".github/workflows/approve-candidate.yml",
      "utf8",
    );
    assert.match(
      workflow,
      /group: approve-candidate-\$\{\{ inputs\.candidate_issue \}\}/,
    );
    assert.match(workflow, /for ATTEMPT in \$\(seq 1 40\)/);
    assert.match(workflow, /if git push origin HEAD:main; then/);
    assert.doesNotMatch(workflow, /gh workflow run pages\.yml/);
  });

  it("submits imported approvals through one bulk endpoint", () => {
    const application = readFileSync("admin-worker/public/app.js", "utf8");
    const worker = readFileSync("admin-worker/src/index.ts", "utf8");
    assert.match(application, /api\("\/api\/decisions\/bulk"/);
    assert.match(application, /approvals: approvals\.map/);
    assert.match(application, /analysis: item\.candidate\.analysis/);
    assert.match(application, /evidence: \[\]/);
    assert.doesNotMatch(application, /candidate: item\.candidate,/);
    assert.match(
      worker,
      /publishApprovedRecords\(token, env\.PUBLIC_REPOSITORY/,
    );
    assert.match(worker, /githubRaw\([\s\S]*contents\/\$\{path\}\?ref=main/);
    assert.doesNotMatch(worker, /approve-batch\.yml\/dispatches/);
    assert.doesNotMatch(
      application,
      /candidates\/\$\{item\.candidate\.issueNumber\}\/approve/,
    );
  });

  it("keeps valid approvals when another candidate lacks analysis", async () => {
    const valid = {
      candidate: {
        candidate_id: "2608.00001v1",
        paper: {
          arxiv_id: "2608.00001",
          version: 1,
          title: "Test paper",
          authors: ["Test Author"],
          primary_category: "math.AG",
          secondary_categories: [],
          submitted: "2026-08-01T00:00:00Z",
          updated: "2026-08-01T00:00:00Z",
          abstract: "Abstract",
          abstract_url: "https://arxiv.org/abs/2608.00001v1",
          pdf_url: "https://arxiv.org/pdf/2608.00001v1",
          source_url: "https://export.arxiv.org/e-print/2608.00001v1",
        },
        evidence: [],
        analysis: {
          structural_counts: {
            pages: 1,
            theorems: 0,
            lemmas: 0,
            propositions: 0,
            corollaries: 0,
            definitions: 0,
            displayed_equations: 0,
            bibliography_entries: 0,
            appendix_pages: 0,
          },
          count_methods: {
            pages: "pdf",
            theorems: "source",
            lemmas: "source",
            propositions: "source",
            corollaries: "source",
            definitions: "source",
            displayed_equations: "source",
            bibliography_entries: "source",
            appendix_pages: "estimated",
          },
          count_notes: [],
        },
      },
      quotation: "ChatGPT was used for proofreading.",
      locationKind: "page",
      locationValue: "PDF page 1",
      page: 1,
      classification: "proofreading_grammar",
      multiplier: 1,
    };
    const result = await prepareApprovalBatch(
      [
        valid,
        {
          ...valid,
          candidate: {
            ...valid.candidate,
            candidate_id: "2608.00002v1",
            analysis: undefined,
          },
        },
      ],
      "reviewer",
      new Date("2026-08-24T00:00:00Z"),
    );
    assert.equal(result.records.length, 1);
    assert.deepEqual(result.queued_ids, ["2608.00001v1"]);
    assert.deepEqual(result.failures, [
      {
        arxiv_id: "2608.00002v1",
        error: "Approval lacks eligible metadata or analysis",
      },
    ]);
  });

  it("recovers canceled approvals sequentially without stopping early", () => {
    const workflow = readFileSync(
      ".github/workflows/recover-cancelled-approvals.yml",
      "utf8",
    );
    assert.match(workflow, /conclusion == "cancelled"/);
    assert.match(workflow, /actions\/runs\/\$\{RUN_ID\}\/rerun/);
    assert.match(workflow, /for RUN_ID in "\$\{RUN_IDS\[@\]\}"/);
    assert.match(workflow, /FAILURES=\$\(\(FAILURES \+ 1\)\)/);
  });
});
