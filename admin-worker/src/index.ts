interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  ADMIN_LOGIN: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  GITHUB_REPOSITORY: string;
  PUBLIC_REPOSITORY: string;
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

interface CandidatePayload {
  candidate_id: string;
  paper: {
    title: string;
    authors: string[];
    primary_category: string;
    secondary_categories: string[];
    submitted: string;
    abstract_url: string;
  };
  evidence: Array<{
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

const API_VERSION = "2022-11-28";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const classifications: Record<
  string,
  { label: string; multiplier: number | null }
> = {
  proofreading_translation: {
    label: "Proofreading, grammar, or translation",
    multiplier: 1,
  },
  brainstorming_literature_code: {
    label: "Brainstorming, literature assistance, or code",
    multiplier: 2,
  },
  rewriting_drafting: {
    label: "Rewriting or drafting portions",
    multiplier: 5,
  },
  substantial_generation: {
    label: "Substantial text, proofs, or content generation",
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
  return response.json() as Promise<T>;
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

function candidateStatus(issue: GitHubIssue): string {
  const names = new Set(issue.labels.map((label) => label.name));
  if (names.has("candidate:approval-submitted")) return "approval-submitted";
  if (names.has("candidate:approved")) return "approved";
  if (names.has("candidate:rejected")) return "rejected";
  return "pending";
}

function publicCandidate(issue: GitHubIssue): object {
  const payload = candidatePayload(issue.body ?? "");
  return {
    issueNumber: issue.number,
    issueUrl: issue.html_url,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    status: candidateStatus(issue),
    ...payload,
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
    const issues = await github<GitHubIssue[]>(
      token,
      `/repos/${env.GITHUB_REPOSITORY}/issues?state=all&labels=paper-candidate&per_page=100`,
    );
    return json({ candidates: issues.map(publicCandidate) });
  }

  if (pathname === "/api/runs" && request.method === "GET") {
    const runs = await github<{ workflow_runs: unknown[] }>(
      token,
      `/repos/${env.GITHUB_REPOSITORY}/actions/runs?per_page=20`,
    );
    return json(runs);
  }

  if (pathname === "/api/scan" && request.method === "POST") {
    const body = await requestBody(request);
    const scanDate = validDate(body.scanDate);
    const maxResults = Number(body.maxResults ?? 50);
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 500) {
      return json({ error: "Maximum results must be from 1 through 500" }, 400);
    }
    const result = await github<unknown>(
      token,
      `/repos/${env.GITHUB_REPOSITORY}/actions/workflows/candidate-discovery.yml/dispatches`,
      "POST",
      {
        ref: "main",
        inputs: { scan_date: scanDate, max_results: String(maxResults) },
      },
    );
    return json({ accepted: true, workflow: result ?? null }, 202);
  }

  const candidateRoute = pathname.match(
    /^\/api\/candidates\/(\d+)\/(reject|approve)$/,
  );
  if (candidateRoute && request.method === "POST") {
    const issueNumber = Number(candidateRoute[1]);
    const action = candidateRoute[2];
    const body = await requestBody(request);
    const issue = await github<GitHubIssue>(
      token,
      `/repos/${env.GITHUB_REPOSITORY}/issues/${issueNumber}`,
    );
    if (candidateStatus(issue) !== "pending")
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
    if (body.confirmation !== true) {
      return json({ error: "Explicit human confirmation is required" }, 400);
    }
    const page =
      body.page === null || body.page === "" ? "" : String(Number(body.page));
    const approvalPayload: CandidatePayload = {
      ...payload,
      evidence: [payload.evidence[evidenceIndex - 1]],
    };
    await github(
      token,
      `/repos/${env.PUBLIC_REPOSITORY}/actions/workflows/approve-candidate.yml/dispatches`,
      "POST",
      {
        ref: "main",
        inputs: {
          candidate_repository: env.GITHUB_REPOSITORY,
          candidate_issue: String(issueNumber),
          candidate_payload: base64Url(
            encoder.encode(JSON.stringify(approvalPayload)),
          ),
          reviewer: user.login,
          evidence_index: "1",
          classification,
          multiplier: String(multiplier),
          quotation: String(body.quotation ?? ""),
          location_kind: String(body.locationKind ?? ""),
          location_value: String(body.locationValue ?? ""),
          page,
          rationale: String(body.rationale ?? ""),
          confirmation: "APPROVE",
        },
      },
    );
    await github(
      token,
      `/repos/${env.GITHUB_REPOSITORY}/issues/${issueNumber}/comments`,
      "POST",
      { body: "Human review completed. Approval workflow dispatched." },
    );
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
    const result = (await response.json()) as {
      access_token?: string;
      error_description?: string;
      expires_in?: number;
      scope?: string;
    };
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
        return authentication(request, env, pathname);
      if (pathname.startsWith("/api/")) return api(request, env, pathname);
      return env.ASSETS.fetch(request);
    } catch (error) {
      if (error instanceof Response) return error;
      const message =
        error instanceof Error
          ? error.message
          : "Unexpected administrator error";
      return json({ error: message }, 500);
    }
  },
};
