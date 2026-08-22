import type { DisclosureClassification } from "./types";

export const disclosureLabels: Record<DisclosureClassification, string> = {
  proofreading_grammar: "Proofreading, grammar, or spelling",
  translation: "Translation",
  formatting_typesetting: "Formatting or typesetting",
  literature_search: "Literature search",
  citation_assistance: "Citation assistance",
  brainstorming_outlining: "Brainstorming or outlining",
  code_assistance: "Code generation, completion, or debugging",
  computational_support: "Computational experiments or data processing",
  rewriting_existing_text: "Rewriting existing author-written text",
  limited_text_drafting: "Drafting limited passages",
  mathematical_examples_conjectures:
    "Suggesting mathematical examples or conjectures",
  substantial_text_generation: "Substantial text generation",
  proof_ideas_steps: "Proof ideas or individual proof-step assistance",
  complete_proof_drafting: "Drafting a complete proof for author revision",
  substantial_proof_generation: "Substantial proof generation",
  substantial_mathematical_content:
    "Substantial mathematical content or result generation",
  mixed_or_other: "Mixed or intermediate disclosed use",
};
