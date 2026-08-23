interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  ADMIN_LOGIN: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  GITHUB_REPOSITORY: string;
  PUBLIC_REPOSITORY: string;
  SCAN_HISTORY_START: string;
  SESSION_SECRET: string;
}

interface GitHubUser {
  login: string;
  avatar_url: string;
}

interface GitHubLabel {
  name: string;
}

interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  labels: GitHubLabel[];
}

interface GitHubComment {
  body: string;
}

interface ApprovedCollection {
  papers: Array<{ arxiv_id: string; version: number }>;
}

interface CandidatePayload {
  candidate_id: string;
  paper: {
    title: string;
    authors: string[];
    primary_category: string;
    secondary_categories: string[];
    submitted: string;
    abstract_url: string;
    pdf_url: string;
  };
  evidence: Array<{
    term?: string;
    matched_sentence?: string;
    quotation: string;
    location_kind: "page" | "metadata";
    location_value: string;
    page?: number | null;
  }>;
  analysis?: {
    structural_counts: Record<string, number>;
    count_methods: Record<string, string>;
    count_notes: string[];
  };
}

interface ApprovalRequest {
  candidatePayload: string;
  reviewer: string;
  evidenceIndex: string;
  classification: string;
  multiplier: string;
  quotation: string;
  locationKind: string;
  locationValue: string;
  page: string;
}

interface ScanSession {
  version: number;
  session_id: string;
  issue_number?: number;
  status: "queued" | "running" | "completed" | "failed";
  stage: string;
  start_date: string | null;
  end_date: string | null;
  total: number | null;
  processed: number;
  candidates: number;
  errors: number;
  current: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  completed_release_dates?: string[];
}

const API_VERSION = "2022-11-28";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const classifications: Record<
  string,
  { label: string; multiplier: number | null }
> = {
  proofreading_grammar: {
    label: "Proofreading, grammar, or spelling",
    multiplier: 1,
  },
  translation: { label: "Translation", multiplier: 1 },
  formatting_typesetting: { label: "Formatting or typesetting", multiplier: 1 },
  literature_search: { label: "Literature search", multiplier: 2 },
  citation_assistance: { label: "Citation assistance", multiplier: 2 },
  brainstorming_outlining: {
    label: "Brainstorming or outlining",
    multiplier: 2,
  },
  code_assistance: {
    label: "Code generation, completion, or debugging",
    multiplier: 2,
  },
  computational_support: {
    label: "Computational experiments or data processing",
    multiplier: 3,
  },
  rewriting_existing_text: {
    label: "Rewriting existing author-written text",
    multiplier: 4,
  },
  limited_text_drafting: {
    label: "Drafting limited passages",
    multiplier: 5,
  },
  mathematical_examples_conjectures: {
    label: "Suggesting mathematical examples or conjectures",
    multiplier: 6,
  },
  substantial_text_generation: {
    label: "Substantial text generation",
    multiplier: 7,
  },
  proof_ideas_steps: {
    label: "Proof ideas or individual proof-step assistance",
    multiplier: 8,
  },
  complete_proof_drafting: {
    label: "Drafting a complete proof for author revision",
    multiplier: 9,
  },
  substantial_proof_generation: {
    label: "Substantial proof generation",
    multiplier: 10,
  },
  substantial_mathematical_content: {
    label: "Substantial mathematical content or result generation",
    multiplier: 10,
  },
  mixed_or_other: {
    label: "Mixed or intermediate disclosed use",
    multiplier: null,
  },
};

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

async function seal(value: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(secret),
    encoder.encode(value),
  );
  const output = new Uint8Array(iv.length + encrypted.byteLength);
  output.set(iv);
  output.set(new Uint8Array(encrypted), iv.length);
  return base64Url(output);
}

async function unseal(value: string, secret: string): Promise<string | null> {
  try {
    const input = fromBase64Url(value);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: input.slice(0, 12) },
      await encryptionKey(secret),
      input.slice(12),
    );
    return decoder.decode(decrypted);
  } catch {
    return null;
  }
}

function cookies(request: Request): Record<string, string> {
  return Object.fromEntries(
    (request.headers.get("Cookie") ?? "")
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([name, value]) => Boolean(name && value)),
  );
}

function json(
  payload: unknown,
  status = 200,
  headers: HeadersInit = {},
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Cache-Control", "no-store");
  return Response.json(payload, {
    status,
    headers: responseHeaders,
  });
}

function secureCookie(
  name: string,
  value: string,
  maxAge: number,
  sameSite = "Strict",
): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=${sameSite}; Max-Age=${maxAge}`;
}

async function github<T>(
  token: string,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "slop-factor-admin/0.1",
        "X-GitHub-Api-Version": API_VERSION,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const details = await response.text();
      throw new Error(
        `GitHub API returned ${response.status}: ${details.slice(0, 300)}`,
      );
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (text.trim()) {
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error(`GitHub API returned invalid JSON for ${path}`);
      }
    }
    if (method !== "GET" || attempt > 0) {
      throw new Error(`GitHub API returned an empty response for ${path}`);
    }
  }
  throw new Error(`GitHub API returned an empty response for ${path}`);
}

async function githubRaw(token: string, path: string): Promise<string> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github.raw+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "slop-factor-admin/0.1",
      "X-GitHub-Api-Version": API_VERSION,
    },
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(
      `GitHub API returned ${response.status}: ${details.slice(0, 300)}`,
    );
  }
  return response.text();
}

async function githubPages<T>(token: string, path: string): Promise<T[]> {
  const results: T[] = [];
  for (let page = 1; ; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const batch = await github<T[]>(token, `${path}${separator}page=${page}`);
    results.push(...batch);
    if (batch.length < 100) return results;
  }
}

function nextDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function isWeekend(value: string): boolean {
  const day = new Date(`${value}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

export function latestDateFromFeed(atom: string): string {
  const published = atom.match(
    /<entry\b[\s\S]*?<published>(\d{4}-\d{2}-\d{2})T/,
  )?.[1];
  if (!published) throw new Error("arXiv returned no mathematics papers");
  return published;
}

export function latestDateFromListing(html: string): string {
  const match = html.match(
    /Showing new listings for (?:[A-Za-z]+,\s*)?(\d{1,2}) ([A-Za-z]+) (\d{4})/i,
  );
  if (!match) throw new Error("arXiv listing has no release date");
  const month = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ].indexOf(match[2].toLowerCase());
  if (month < 0) throw new Error("arXiv listing has an invalid release month");
  const date = new Date(Date.UTC(Number(match[3]), month, Number(match[1])));
  if (
    date.getUTCFullYear() !== Number(match[3]) ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== Number(match[1])
  ) {
    throw new Error("arXiv listing has an invalid release date");
  }
  return date.toISOString().slice(0, 10);
}

async function latestMathReleaseDate(): Promise<string> {
  const errors: string[] = [];
  for (const url of [
    "https://export.arxiv.org/list/math/new",
    "https://arxiv.org/list/math/new",
  ]) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "text/html",
          "User-Agent": "slop-factor-admin/0.1",
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return latestDateFromListing(await response.text());
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "request failed");
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(
    `Could not refresh the arXiv release date: ${errors.join("; ")}`,
  );
}

export function countsAsCompletedScan(scan: ScanSession): boolean {
  return (
    scan.status === "completed" &&
    scan.total !== null &&
    scan.total > 0 &&
    scan.processed === scan.total &&
    scan.errors === 0
  );
}

async function administrator(
  request: Request,
  env: Env,
): Promise<{ token: string; user: GitHubUser }> {
  const encrypted = cookies(request).sf_session;
  const token = encrypted ? await unseal(encrypted, env.SESSION_SECRET) : null;
  if (!token) throw new Response("Authentication required", { status: 401 });
  const user = await github<GitHubUser>(token, "/user");
  if (user.login.toLowerCase() !== env.ADMIN_LOGIN.toLowerCase()) {
    throw new Response("Administrator access required", { status: 403 });
  }
  const permission = await github<{ permission: string }>(
    token,
    `/repos/${env.GITHUB_REPOSITORY}/collaborators/${encodeURIComponent(user.login)}/permission`,
  );
  if (permission.permission !== "admin") {
    throw new Response("Repository administrator access required", {
      status: 403,
    });
  }
  return { token, user };
}

function candidatePayload(body: string): CandidatePayload {
  const match = body.match(/<!-- slop-factor-payload:([A-Za-z0-9_-]+) -->/);
  if (!match)
    throw new Error("Candidate issue is missing its private review payload");
  return JSON.parse(
    decoder.decode(fromBase64Url(match[1])),
  ) as CandidatePayload;
}

export function approvalRequestComment(request: ApprovalRequest): string {
  return `Human review completed. Approval workflow dispatched.\n\n<!-- slop-factor-approval:${base64Url(
    encoder.encode(JSON.stringify(request)),
  )} -->`;
}

export function approvalRequestFromComments(
  comments: GitHubComment[],
): ApprovalRequest | null {
  for (const comment of comments.toReversed()) {
    const match = comment.body.match(
      /<!-- slop-factor-approval:([A-Za-z0-9_-]+) -->/,
    );
    if (match) {
      return JSON.parse(
        decoder.decode(fromBase64Url(match[1])),
      ) as ApprovalRequest;
    }
  }
  return null;
}

async function dispatchApproval(
  token: string,
  env: Env,
  issueNumber: number,
  request: ApprovalRequest,
): Promise<void> {
  await github<unknown>(
    token,
    `/repos/${env.PUBLIC_REPOSITORY}/actions/workflows/approve-candidate.yml/dispatches`,
    "POST",
    {
      ref: "main",
      inputs: {
        candidate_repository: env.GITHUB_REPOSITORY,
        candidate_issue: String(issueNumber),
        candidate_payload: request.candidatePayload,
        reviewer: request.reviewer,
        evidence_index: request.evidenceIndex,
        classification: request.classification,
        multiplier: request.multiplier,
        quotation: request.quotation,
        location_kind: request.locationKind,
        location_value: request.locationValue,
        page: request.page,
        confirmation: "APPROVE",
      },
    },
  );
}

function scanIssueBody(session: ScanSession): string {
  return `<!-- slop-factor-scan:${base64Url(
    encoder.encode(JSON.stringify(session)),
  )} -->\n`;
}

function scanSession(body: string): ScanSession {
  const match = body.match(/<!-- slop-factor-scan:([A-Za-z0-9_-]+) -->/);
  if (!match) throw new Error("Scan issue is missing progress data");
  return JSON.parse(decoder.decode(fromBase64Url(match[1]))) as ScanSession;
}

async function ensureScanLabel(token: string, repository: string) {
  try {
    await github(
      token,
      `/repos/${repository}/labels/${encodeURIComponent("scan-session")}`,
    );
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("returned 404"))
      throw error;
    await github(token, `/repos/${repository}/labels`, "POST", {
      name: "scan-session",
      color: "6f7781",
      description: "Private candidate scan progress",
    });
  }
}

function candidateStatus(issue: GitHubIssue): string {
  const names = new Set(issue.labels.map((label) => label.name));
  if (names.has("candidate:approved")) return "approved";
  if (names.has("candidate:approval-submitted")) return "approval-submitted";
  if (names.has("candidate:rejected")) return "rejected";
  return "pending";
}

async function reconcileApprovedIssues(
  token: string,
  repository: string,
  issues: GitHubIssue[],
  approvedCandidateIds: Set<string>,
): Promise<void> {
  const updates = issues.filter((issue) => {
    if (candidateStatus(issue) !== "approval-submitted") return false;
    return approvedCandidateIds.has(
      candidatePayload(issue.body ?? "").candidate_id,
    );
  });
  await Promise.allSettled(
    updates.map((issue) =>
      github(token, `/repos/${repository}/issues/${issue.number}`, "PATCH", {
        state: "closed",
        state_reason: "completed",
        labels: ["paper-candidate", "candidate:approved"],
      }),
    ),
  );
}

function publicCandidate(
  issue: GitHubIssue,
  approvedCandidateIds: Set<string>,
): object {
  const payload = candidatePayload(issue.body ?? "");
  return {
    ...payload,
    issueNumber: issue.number,
    issueUrl: issue.html_url,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    status: approvedCandidateIds.has(payload.candidate_id)
      ? "approved"
      : candidateStatus(issue),
  };
}

function assertMutationOrigin(request: Request): void {
  const origin = request.headers.get("Origin");
  if (origin !== new URL(request.url).origin) {
    throw new Response("Invalid request origin", { status: 403 });
  }
}

async function requestBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.startsWith("application/json")) {
    throw new Response("JSON request required", { status: 415 });
  }
  return request.json() as Promise<Record<string, unknown>>;
}

function validDate(value: unknown): string {
  const text = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text))
    throw new Response("Invalid scan date", { status: 400 });
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed > new Date()) {
    throw new Response("Scan date cannot be in the future", { status: 400 });
  }
  return text;
}

async function api(
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response> {
  const { token, user } = await administrator(request, env);
  if (request.method !== "GET") assertMutationOrigin(request);

  if (pathname === "/api/session" && request.method === "GET") {
    return json({ user, repository: env.GITHUB_REPOSITORY });
  }

  if (pathname === "/api/candidates" && request.method === "GET") {
    const [issues, approvedFile] = await Promise.all([
      githubPages<GitHubIssue>(
        token,
        `/repos/${env.GITHUB_REPOSITORY}/issues?state=all&labels=paper-candidate&per_page=100`,
      ),
      githubRaw(
        token,
        `/repos/${env.PUBLIC_REPOSITORY}/contents/data/approved/papers.json?ref=main`,
      ),
    ]);
    const approved = JSON.parse(approvedFile) as ApprovedCollection;
    const approvedCandidateIds = new Set(
      approved.papers.map((paper) => `${paper.arxiv_id}v${paper.version}`),
    );
    await reconcileApprovedIssues(
      token,
      env.GITHUB_REPOSITORY,
      issues,
      approvedCandidateIds,
    );
    return json({
      candidates: issues.map((issue) =>
        publicCandidate(issue, approvedCandidateIds),
      ),
    });
  }

  if (pathname === "/api/site/deploy" && request.method === "POST") {
    await github<unknown>(
      token,
      `/repos/${env.PUBLIC_REPOSITORY}/actions/workflows/pages.yml/dispatches`,
      "POST",
      { ref: "main" },
    );
    return json({ accepted: true }, 202);
  }

  if (pathname === "/api/runs" && request.method === "GET") {
    const runs = await github<{ workflow_runs: unknown[] }>(
      token,
      `/repos/${env.GITHUB_REPOSITORY}/actions/runs?per_page=20`,
    );
    return json(runs);
  }

  if (pathname === "/api/scans/current" && request.method === "GET") {
    const issues = await github<GitHubIssue[]>(
      token,
      `/repos/${env.GITHUB_REPOSITORY}/issues?state=all&labels=scan-session&sort=created&direction=desc&per_page=1`,
    );
    if (!issues[0]) return json({ scan: null });
    const scan = scanSession(issues[0].body ?? "");
    return json({ scan: { ...scan, issue_number: issues[0].number } });
  }

  if (pathname === "/api/scans/history" && request.method === "GET") {
    const issues = await githubPages<GitHubIssue>(
      token,
      `/repos/${env.GITHUB_REPOSITORY}/issues?state=all&labels=scan-session&sort=created&direction=asc&per_page=100`,
    );
    const scans = issues
      .filter((issue) => issue.created_at >= env.SCAN_HISTORY_START)
      .map((issue) => scanSession(issue.body ?? ""));
    const completedDates = new Set<string>();
    const requestedDates = scans
      .flatMap((scan) => [scan.start_date, scan.end_date])
      .filter((value): value is string => Boolean(value));
    for (const scan of scans) {
      if (scan.completed_release_dates?.length) {
        for (const date of scan.completed_release_dates) {
          completedDates.add(date);
        }
        continue;
      }
      if (!countsAsCompletedScan(scan) || !scan.start_date || !scan.end_date)
        continue;
      for (
        let date = scan.start_date;
        date <= scan.end_date;
        date = nextDate(date)
      ) {
        if (!isWeekend(date)) completedDates.add(date);
      }
    }
    const scannedDates = [...completedDates].sort();
    const url = new URL(request.url);
    const suppliedAvailable = url.searchParams.get("available");
    const latestAvailable =
      url.searchParams.get("refresh") === "available"
        ? await latestMathReleaseDate()
        : /^\d{4}-\d{2}-\d{2}$/.test(suppliedAvailable ?? "")
          ? suppliedAvailable
          : null;
    const cutoff = latestAvailable ?? requestedDates.sort().at(-1) ?? null;
    let nextUnscanned = requestedDates.sort()[0] ?? cutoff;
    while (
      nextUnscanned &&
      cutoff &&
      nextUnscanned <= cutoff &&
      (completedDates.has(nextUnscanned) || isWeekend(nextUnscanned))
    ) {
      nextUnscanned = nextDate(nextUnscanned);
    }
    return json({
      scanned_dates: scannedDates,
      latest_available: latestAvailable,
      next_unscanned:
        nextUnscanned && cutoff && nextUnscanned <= cutoff
          ? nextUnscanned
          : null,
    });
  }

  if (pathname === "/api/scan" && request.method === "POST") {
    const body = await requestBody(request);
    const startDate = validDate(body.startDate);
    const endDate = validDate(body.endDate);
    if (endDate < startDate) {
      return json({ error: "End date cannot be before start date" }, 400);
    }
    const openIssues = await github<GitHubIssue[]>(
      token,
      `/repos/${env.GITHUB_REPOSITORY}/issues?state=open&labels=scan-session&per_page=10`,
    );
    const active = openIssues
      .map((issue) => scanSession(issue.body ?? ""))
      .find((scan) => scan.status === "queued" || scan.status === "running");
    if (active) return json({ error: "A scan is already in progress" }, 409);

    await ensureScanLabel(token, env.GITHUB_REPOSITORY);
    const createdAt = new Date().toISOString();
    const session: ScanSession = {
      version: 1,
      session_id: crypto.randomUUID(),
      status: "queued",
      stage: "Waiting for runner",
      start_date: startDate,
      end_date: endDate,
      total: null,
      processed: 0,
      candidates: 0,
      errors: 0,
      current: "",
      completed_release_dates: [],
      created_at: createdAt,
      updated_at: createdAt,
    };
    const issue = await github<GitHubIssue>(
      token,
      `/repos/${env.GITHUB_REPOSITORY}/issues`,
      "POST",
      {
        title:
          startDate === endDate
            ? `Scan ${startDate}`
            : `Scan ${startDate} to ${endDate}`,
        body: scanIssueBody(session),
        labels: ["scan-session"],
      },
    );
    try {
      await github<unknown>(
        token,
        `/repos/${env.GITHUB_REPOSITORY}/actions/workflows/candidate-discovery.yml/dispatches`,
        "POST",
        {
          ref: "main",
          inputs: {
            start_date: startDate,
            end_date: endDate,
            scan_issue: String(issue.number),
          },
        },
      );
    } catch (error) {
      const failedAt = new Date().toISOString();
      await github(
        token,
        `/repos/${env.GITHUB_REPOSITORY}/issues/${issue.number}`,
        "PATCH",
        {
          state: "closed",
          state_reason: "completed",
          body: scanIssueBody({
            ...session,
            status: "failed",
            stage: "Dispatch failed",
            updated_at: failedAt,
            completed_at: failedAt,
          }),
        },
      );
      throw error;
    }
    return json(
      { accepted: true, scan: { ...session, issue_number: issue.number } },
      202,
    );
  }

  const candidateRoute = pathname.match(
    /^\/api\/candidates\/(\d+)\/(reject|approve|retry)$/,
  );
  if (candidateRoute && request.method === "POST") {
    const issueNumber = Number(candidateRoute[1]);
    const action = candidateRoute[2];
    const body = await requestBody(request);
    const issue = await github<GitHubIssue>(
      token,
      `/repos/${env.GITHUB_REPOSITORY}/issues/${issueNumber}`,
    );
    const status = candidateStatus(issue);

    if (action === "retry") {
      if (status !== "approval-submitted") {
        return json({ error: "Candidate is not awaiting publication" }, 409);
      }
      const comments = await githubPages<GitHubComment>(
        token,
        `/repos/${env.GITHUB_REPOSITORY}/issues/${issueNumber}/comments?per_page=100`,
      );
      const storedRequest = approvalRequestFromComments(comments);
      if (!storedRequest) {
        return json(
          { error: "Original approval data is unavailable; review again" },
          409,
        );
      }
      await dispatchApproval(token, env, issueNumber, storedRequest);
      await github(
        token,
        `/repos/${env.GITHUB_REPOSITORY}/issues/${issueNumber}/comments`,
        "POST",
        { body: "Approval publication retried." },
      );
      return json({ accepted: true }, 202);
    }

    if (status !== "pending")
      return json({ error: "Candidate is not pending" }, 409);

    if (action === "reject") {
      const reason = String(body.reason ?? "").trim();
      if (!reason)
        return json({ error: "A rejection reason is required" }, 400);
      await github(
        token,
        `/repos/${env.GITHUB_REPOSITORY}/issues/${issueNumber}/comments`,
        "POST",
        { body: `Human review decision: rejected.\n\nReason: ${reason}` },
      );
      await github(
        token,
        `/repos/${env.GITHUB_REPOSITORY}/issues/${issueNumber}`,
        "PATCH",
        {
          state: "closed",
          state_reason: "not_planned",
          labels: ["paper-candidate", "candidate:rejected"],
        },
      );
      return json({ rejected: true });
    }

    const payload = candidatePayload(issue.body ?? "");
    const evidenceIndex = Number(body.evidenceIndex);
    const classification = String(body.classification ?? "");
    const selected = classifications[classification];
    const multiplier = Number(body.multiplier);
    if (
      !Number.isInteger(evidenceIndex) ||
      !payload.evidence[evidenceIndex - 1]
    ) {
      return json({ error: "Select a disclosure passage" }, 400);
    }
    if (!selected || multiplier < 1 || multiplier > 10) {
      return json({ error: "Select a valid disclosure classification" }, 400);
    }
    if (selected.multiplier !== null && multiplier !== selected.multiplier) {
      return json(
        { error: "Multiplier does not match the classification" },
        400,
      );
    }
    const page =
      body.page === null || body.page === "" ? "" : String(Number(body.page));
    const approvalPayload: CandidatePayload = {
      ...payload,
      evidence: [payload.evidence[evidenceIndex - 1]],
    };
    const approvalRequest: ApprovalRequest = {
      candidatePayload: base64Url(
        encoder.encode(JSON.stringify(approvalPayload)),
      ),
      reviewer: user.login,
      evidenceIndex: "1",
      classification,
      multiplier: String(multiplier),
      quotation: String(body.quotation ?? ""),
      locationKind: String(body.locationKind ?? ""),
      locationValue: String(body.locationValue ?? ""),
      page,
    };
    await github(
      token,
      `/repos/${env.GITHUB_REPOSITORY}/issues/${issueNumber}/comments`,
      "POST",
      { body: approvalRequestComment(approvalRequest) },
    );
    await dispatchApproval(token, env, issueNumber, approvalRequest);
    await github(
      token,
      `/repos/${env.GITHUB_REPOSITORY}/issues/${issueNumber}`,
      "PATCH",
      {
        labels: ["paper-candidate", "candidate:approval-submitted"],
      },
    );
    return json({ accepted: true }, 202);
  }

  return json({ error: "Not found" }, 404);
}

async function authentication(
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response> {
  const url = new URL(request.url);
  if (pathname === "/auth/start") {
    const state = base64Url(crypto.getRandomValues(new Uint8Array(24)));
    const target = new URL("https://github.com/login/oauth/authorize");
    target.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
    target.searchParams.set("state", state);
    return new Response(null, {
      status: 302,
      headers: {
        Location: target.toString(),
        "Set-Cookie": secureCookie("sf_oauth_state", state, 600, "Lax"),
      },
    });
  }

  if (pathname === "/auth/callback") {
    const state = url.searchParams.get("state") ?? "";
    const code = url.searchParams.get("code") ?? "";
    if (!state || !code || cookies(request).sf_oauth_state !== state) {
      return new Response("OAuth state validation failed", { status: 400 });
    }
    const response = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code,
        }),
      },
    );
    const resultText = await response.text();
    let result: {
      access_token?: string;
      error_description?: string;
      expires_in?: number;
      scope?: string;
    };
    try {
      result = JSON.parse(resultText) as typeof result;
    } catch {
      return new Response("GitHub authorization returned an empty response", {
        status: 502,
      });
    }
    if (!result.access_token) {
      return new Response(
        result.error_description ?? "GitHub authorization failed",
        { status: 401 },
      );
    }
    const encrypted = await seal(result.access_token, env.SESSION_SECRET);
    const maxAge = Math.min(result.expires_in ?? 28_800, 28_800);
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/",
        "Set-Cookie": secureCookie("sf_session", encrypted, maxAge),
      },
    });
  }

  if (pathname === "/auth/logout" && request.method === "POST") {
    assertMutationOrigin(request);
    return json({ loggedOut: true }, 200, {
      "Set-Cookie": secureCookie("sf_session", "", 0),
    });
  }
  return new Response("Not found", { status: 404 });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    try {
      if (pathname.startsWith("/auth/"))
        return await authentication(request, env, pathname);
      if (pathname.startsWith("/api/"))
        return await api(request, env, pathname);
      return await env.ASSETS.fetch(request);
    } catch (error) {
      if (error instanceof Response) return error;
      const message =
        error instanceof Error
          ? error.message
          : "Unexpected administrator error";
      if (message.startsWith("GitHub API returned 401:")) {
        return json({ error: "Authentication required" }, 401, {
          "Set-Cookie": secureCookie("sf_session", "", 0),
        });
      }
      return json({ error: message }, 500);
    }
  },
};
