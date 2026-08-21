export interface FilterablePaper {
  id: string;
  search: string;
  author: string;
  category: string;
  classification: string;
  submitted: string;
  score: number;
  pages: number;
  lemmas: number;
  theorems: number;
}

export interface PaperFilters {
  query: string;
  author: string;
  category: string;
  classification: string;
  dateFrom: string;
  dateTo: string;
  scoreMin: number | null;
  scoreMax: number | null;
  sort: string;
}

function includes(haystack: string, needle: string): boolean {
  return haystack
    .toLocaleLowerCase()
    .includes(needle.trim().toLocaleLowerCase());
}

export function filterAndSortPapers(
  papers: FilterablePaper[],
  filters: PaperFilters,
): FilterablePaper[] {
  const filtered = papers.filter((paper) => {
    if (filters.query && !includes(paper.search, filters.query)) return false;
    if (filters.author && !includes(paper.author, filters.author)) return false;
    if (filters.category && paper.category !== filters.category) return false;
    if (
      filters.classification &&
      paper.classification !== filters.classification
    )
      return false;
    if (filters.dateFrom && paper.submitted < filters.dateFrom) return false;
    if (filters.dateTo && paper.submitted > filters.dateTo) return false;
    if (filters.scoreMin !== null && paper.score < filters.scoreMin)
      return false;
    if (filters.scoreMax !== null && paper.score > filters.scoreMax)
      return false;
    return true;
  });

  const [field = "score", direction = "desc"] = filters.sort.split("-");
  const sign = direction === "asc" ? 1 : -1;

  return filtered.sort((left, right) => {
    const leftValue = left[field as keyof FilterablePaper];
    const rightValue = right[field as keyof FilterablePaper];
    if (leftValue === rightValue) return left.id.localeCompare(right.id);
    return (leftValue < rightValue ? -1 : 1) * sign;
  });
}
