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
    const [result] = validateDecisionInput(
      [{ arxiv_id: pending.candidate_id, decision: "reject" }],
      [pending],
      classifications,
    );
    assert.equal(result.decision, "reject");
    assert.equal(result.candidate, pending);
  });

  it("matches an approval to one exact exported passage", () => {
    const [result] = validateDecisionInput(
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
    const [result] = validateDecisionInput(
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

  it("rejects mismatched evidence and variable classifications", () => {
    assert.throws(
      () =>
        validateDecisionInput(
          [
            {
              arxiv_id: pending.candidate_id,
              decision: "approve",
              quotation: "Different passage",
              location: evidence.location_value,
              page: 7,
              disclosure_classification: "proofreading_grammar",
            },
          ],
          [pending],
          classifications,
        ),
      /do not match exported evidence/,
    );
    assert.throws(
      () =>
        validateDecisionInput(
          [
            {
              arxiv_id: pending.candidate_id,
              decision: "approve",
              quotation: evidence.quotation,
              location: evidence.location_value,
              page: 7,
              disclosure_classification: "mixed_or_other",
            },
          ],
          [pending],
          classifications,
        ),
      /fixed disclosure_classification/,
    );
  });
});
