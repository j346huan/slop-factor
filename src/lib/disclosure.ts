import type { DisclosureClassification } from "./types";

export const disclosureLabels: Record<DisclosureClassification, string> = {
  proofreading_translation: "Proofreading, grammar, or translation",
  brainstorming_literature_code:
    "Brainstorming, literature assistance, or code",
  rewriting_drafting: "Rewriting or drafting portions",
  substantial_generation: "Substantial text, proofs, or content generation",
  mixed_or_other: "Mixed or intermediate disclosed use",
};
