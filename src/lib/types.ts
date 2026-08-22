export const disclosureClassifications = [
  "proofreading_grammar",
  "translation",
  "formatting_typesetting",
  "literature_search",
  "citation_assistance",
  "brainstorming_outlining",
  "code_assistance",
  "computational_support",
  "rewriting_existing_text",
  "limited_text_drafting",
  "mathematical_examples_conjectures",
  "substantial_text_generation",
  "proof_ideas_steps",
  "complete_proof_drafting",
  "substantial_proof_generation",
  "substantial_mathematical_content",
  "mixed_or_other",
] as const;

export type DisclosureClassification =
  (typeof disclosureClassifications)[number];

export interface StructuralCounts {
  pages: number;
  theorems: number;
  lemmas: number;
  propositions: number;
  corollaries: number;
  definitions: number;
  displayed_equations: number;
  bibliography_entries: number;
  appendix_pages: number;
}

export interface ApprovedPaper {
  record_version: 1;
  arxiv_id: string;
  version: number;
  title: string;
  authors: string[];
  categories: {
    primary: string;
    secondary: string[];
  };
  dates: {
    submitted: string;
    updated: string;
    approved: string;
  };
  abstract: string;
  urls: {
    abstract: string;
    pdf: string;
    source: string;
  };
  structural_counts: StructuralCounts;
  count_methods: Record<
    keyof StructuralCounts,
    "source" | "pdf" | "pdf_fallback" | "estimated"
  >;
  count_notes: string[];
  disclosure: {
    quotation: string;
    location: {
      kind: "page" | "metadata";
      value: string;
      page: number | null;
    };
    classification: DisclosureClassification;
    role_label: string;
    multiplier: number;
  };
  verification: {
    status: "verified";
    reviewer: string;
    verified_at: string;
  };
  score: number;
  score_breakdown: {
    formula_version: "1.0";
    base_score: number;
    multiplier: number;
    contributions: StructuralCounts;
  };
}

export interface ApprovedPaperCollection {
  schema_version: 1;
  papers: ApprovedPaper[];
}
