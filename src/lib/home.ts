import type { ApprovedPaper } from "./types";

function submittedDate(paper: ApprovedPaper): string {
  return paper.dates.submitted.slice(0, 10);
}

function byNewest(left: ApprovedPaper, right: ApprovedPaper): number {
  return (
    submittedDate(right).localeCompare(submittedDate(left)) ||
    left.title.localeCompare(right.title)
  );
}

function byScore(left: ApprovedPaper, right: ApprovedPaper): number {
  return right.score - left.score || byNewest(left, right);
}

export function latestPapers(
  papers: ApprovedPaper[],
  limit = 8,
): ApprovedPaper[] {
  return [...papers].sort(byNewest).slice(0, limit);
}

export function topPapers(papers: ApprovedPaper[], limit = 8): ApprovedPaper[] {
  return [...papers].sort(byScore).slice(0, limit);
}

export function totalSlop(papers: ApprovedPaper[]): number {
  return papers.reduce((sum, paper) => sum + paper.score, 0);
}

export function topPapersThisWeek(
  papers: ApprovedPaper[],
  today: string,
  limit = 8,
): ApprovedPaper[] {
  const start = new Date(`${today}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 6);
  const firstDay = start.toISOString().slice(0, 10);
  return papers
    .filter((paper) => {
      const date = submittedDate(paper);
      return date >= firstDay && date <= today;
    })
    .sort(byScore)
    .slice(0, limit);
}

export interface DailySlop {
  date: string;
  total: number;
}

export function dailySlopSeries(
  papers: ApprovedPaper[],
  today: string,
): DailySlop[] {
  if (papers.length === 0) return [];
  const totals = new Map<string, number>();
  for (const paper of papers) {
    const date = submittedDate(paper);
    totals.set(date, (totals.get(date) ?? 0) + paper.score);
  }

  const firstDay = [...totals.keys()].sort()[0];
  if (!firstDay || firstDay > today) return [];
  const day = new Date(`${firstDay}T00:00:00Z`);
  const end = new Date(`${today}T00:00:00Z`);
  const series: DailySlop[] = [];
  while (day <= end) {
    const date = day.toISOString().slice(0, 10);
    series.push({ date, total: totals.get(date) ?? 0 });
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return series;
}
