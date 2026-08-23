import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPendingExport,
  validateDecisionInput,
} from "../../admin-worker/public/decisions.js";

const evidence = {
  term: "ChatGPT",
  quotation: "The authors used ChatGPT for proofreading.",
  location_value: "PDF page 7",
  page: 7,
};
const pending = {
  candidate_id: "2608.00001v1",
  status: "pending",
  paper: { title: "Not exported" },
  evidence: [evidence],
};
const classifications = {
  proofreading_grammar: ["Proofreading, grammar, or spelling", 1],
  limited_text_drafting: ["Drafting limited passages", 5],
  mixed_or_other: ["Mixed or intermediate disclosed use", null],
};

describe("pending decision files", () => {
  it("exports only IDs and disclosure evidence for pending papers", () => {
    assert.deepEqual(
      buildPendingExport([
        pending,
        {
          ...pending,
          candidate_id: "2608.00002v1",
          status: "approved",
        },
      ]),
      [
        {
          arxiv_id: "2608.00001v1",
          disclosures: [
            {
              quotation: evidence.quotation,
              location: evidence.location_value,
              page: 7,
            },
          ],
        },
      ],
    );
  });

  it("accepts reject decisions without additional fields", () => {
    const {
      decisions: [result],
    } = validateDecisionInput(
      [{ arxiv_id: pending.candidate_id, decision: "reject" }],
      [pending],
      classifications,
    );
    assert.equal(result.decision, "reject");
    assert.equal(result.candidate, pending);
  });

  it("matches an approval to one exact exported passage", () => {
    const {
      decisions: [result],
    } = validateDecisionInput(
      [
        {
          arxiv_id: pending.candidate_id,
          decision: "approve",
          quotation: evidence.quotation,
          location: evidence.location_value,
          page: 7,
          disclosure_classification: "proofreading_grammar",
        },
      ],
      [pending],
      classifications,
    );
    assert.equal(result.evidenceIndex, 1);
    assert.equal(result.multiplier, 1);
    assert.equal(result.locationKind, "page");
  });

  it("accepts an arXiv metadata disclosure with a null page", () => {
    const metadata = {
      ...pending,
      candidate_id: "2608.19074v1",
      evidence: [
        {
          quotation: "ChatGPT was used in developing and drafting this result.",
          location_value: "arXiv metadata: abstract",
          page: null,
        },
      ],
    };
    const {
      decisions: [result],
    } = validateDecisionInput(
      [
        {
          arxiv_id: metadata.candidate_id,
          decision: "approve",
          quotation: metadata.evidence[0].quotation,
          location: metadata.evidence[0].location_value,
          page: null,
          disclosure_classification: "limited_text_drafting",
        },
      ],
      [metadata],
      classifications,
    );
    assert.equal(result.page, null);
    assert.equal(result.locationKind, "metadata");
    assert.equal(result.multiplier, 5);
  });

  it("skips non-pending papers, accepts quotation overrides, and continues", () => {
    const approved = {
      ...pending,
      candidate_id: "2608.00002v1",
      status: "approved",
    };
    const laterPending = {
      ...pending,
      candidate_id: "2608.00003v1",
    };
    const result = validateDecisionInput(
      [
        { arxiv_id: approved.candidate_id, decision: "reject" },
        {
          arxiv_id: pending.candidate_id,
          decision: "approve",
          quotation: "Different passage",
          location: evidence.location_value,
          page: 7,
          disclosure_classification: "proofreading_grammar",
        },
        { arxiv_id: laterPending.candidate_id, decision: "reject" },
      ],
      [pending, approved, laterPending],
      classifications,
    );
    assert.deepEqual(result.skipped, [
      { arxiv_id: approved.candidate_id, reason: "not pending" },
    ]);
    assert.equal(result.errors.length, 0);
    assert.equal(result.decisions.length, 2);
    assert.equal(result.decisions[0].quotation, "Different passage");
    assert.equal(result.decisions[1].candidate, laterPending);
  });
});
