import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  approvalRequestComment,
  approvalRequestFromComments,
  countsAsCompletedScan,
  latestDateFromFeed,
  latestDateFromListing,
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
    assert.match(application, /api\("\/api\/decisions\/bulk"/);
    assert.match(application, /approvals: approvals\.map/);
    assert.doesNotMatch(
      application,
      /candidates\/\$\{item\.candidate\.issueNumber\}\/approve/,
    );
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
