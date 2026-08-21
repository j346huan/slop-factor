import type { StructuralCounts } from "./types";

export function baseScore(counts: StructuralCounts): number {
  return (
    counts.pages +
    6 * counts.theorems +
    4 * counts.lemmas +
    4 * counts.propositions +
    3 * counts.corollaries +
    2 * counts.definitions +
    counts.displayed_equations / 4 +
    counts.bibliography_entries / 10 +
    2 * counts.appendix_pages
  );
}

export function calculateScore(
  counts: StructuralCounts,
  multiplier: number,
): number {
  return Math.round(multiplier * baseScore(counts) * 10_000) / 10_000;
}

export function scoreCalculation(
  counts: StructuralCounts,
  multiplier: number,
): string {
  return `${multiplier} × (${counts.pages} + 6×${counts.theorems} + 4×${counts.lemmas} + 4×${counts.propositions} + 3×${counts.corollaries} + 2×${counts.definitions} + ${counts.displayed_equations}/4 + ${counts.bibliography_entries}/10 + 2×${counts.appendix_pages})`;
}
