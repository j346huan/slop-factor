import { buildPendingExport, validateDecisionInput } from "./decisions.js";

const state = {
  approvedIds: new Set(),
  candidates: [],
  latestAvailable: null,
  selected: null,
  scanTimer: null,
};
const classifications = {
  proofreading_grammar: ["Proofreading, grammar, or spelling", 1],
  translation: ["Translation", 1],
  formatting_typesetting: ["Formatting or typesetting", 1],
  literature_search: ["Literature search", 2],
  citation_assistance: ["Citation assistance", 2],
  brainstorming_outlining: ["Brainstorming or outlining", 2],
  code_assistance: ["Code generation, completion, or debugging", 2],
  computational_support: ["Computational experiments or data processing", 3],
  rewriting_existing_text: ["Rewriting existing author-written text", 4],
  limited_text_drafting: ["Drafting limited passages", 5],
  mathematical_examples_conjectures: [
    "Suggesting mathematical examples or conjectures",
    6,
  ],
  substantial_text_generation: ["Substantial text generation", 7],
  proof_ideas_steps: ["Proof ideas or individual proof-step assistance", 8],
  complete_proof_drafting: ["Drafting a complete proof for author revision", 9],
  substantial_proof_generation: ["Substantial proof generation", 10],
  substantial_mathematical_content: [
    "Substantial mathematical content or result generation",
    10,
  ],
  mixed_or_other: ["Mixed or intermediate disclosed use", null],
};

const elements = Object.fromEntries(
  [
    "account",
    "admin-count",
    "approved-count",
    "candidate-list",
    "dashboard",
    "decision-file",
    "empty-state",
    "export-pending",
    "import-decisions",
    "login-panel",
    "latest-arxiv-date",
    "notice",
    "next-unscanned",
    "pending-count",
    "rejected-count",
    "refresh-available",
    "review-content",
    "review-dialog",
    "review-title",
    "scan-candidates",
    "scan-current",
    "scan-end-date",
    "scan-errors",
    "scan-percent",
    "scan-processed",
    "scan-progress",
    "scan-session",
    "scan-stage",
    "scan-start-date",
    "scan-total",
    "scanned-dates",
    "search",
    "status-filter",
    "update-front-page",
  ].map((id) => [id, document.getElementById(id)]),
);

async function api(path, options = {}) {
  let response;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
    });
    const retryable = !options.method || options.method === "GET";
    if (
      !retryable ||
      ![502, 503, 504].includes(response.status) ||
      attempt === 2
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
  }
  if (response.status === 401) {
    window.location.assign("/auth/start");
    throw new Error("Authentication required");
  }
  const payload = response.headers.get("Content-Type")?.includes("json")
    ? await response.json()
    : {
        error:
          response.status >= 500
            ? `Administrator request failed (${response.status})`
            : await response.text(),
      };
  if (!response.ok) {
    const error = new Error(
      payload.error || `Request failed (${response.status})`,
    );
    error.status = response.status;
    throw error;
  }
  return payload;
}

function showNotice(message, tone = "info") {
  elements.notice.textContent = message;
  elements.notice.dataset.tone = tone;
  elements.notice.hidden = false;
}

function pendingExport() {
  return buildPendingExport(state.candidates);
}

function downloadPending() {
  const pending = pendingExport();
  const blob = new Blob([JSON.stringify(pending, null, 2) + "\n"], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `slop-factor-pending-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showNotice(`Exported ${pending.length} pending papers.`, "success");
}

function validatedDecisions(value) {
  return validateDecisionInput(value, state.candidates, classifications);
}

async function applyDecisionFile(file) {
  let value;
  try {
    value = JSON.parse(await file.text());
  } catch {
    throw new Error("Decision file is not valid JSON");
  }
  const { decisions, skipped, errors } = validatedDecisions(value);
  const failures = [...errors];
  let approvedCount = 0;
  let rejected = 0;
  let deferred = 0;
  const approvals = decisions.filter((item) => item.decision === "approve");
  const rejections = decisions.filter((item) => item.decision === "reject");

  if (approvals.length > 0) {
    try {
      const result = await api("/api/decisions/bulk", {
        method: "POST",
        body: JSON.stringify({
          approvals: approvals.map((item) => ({
            candidate: item.candidate,
            quotation: item.quotation,
            locationKind: item.locationKind,
            locationValue: item.location,
            page: item.page,
            classification: item.classification,
            multiplier: item.multiplier,
          })),
        }),
      });
      const approvedIds = new Set(result.approved_ids ?? []);
      for (const item of approvals) {
        if (approvedIds.has(item.candidate.candidate_id)) {
          item.candidate.status = "approved";
          state.approvedIds.add(item.candidate.candidate_id);
        }
      }
      approvedCount = result.approvals ?? 0;
      failures.push(...(result.failures ?? []));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request failed";
      failures.push({
        arxiv_id: `${approvals.length} approval(s)`,
        error: message,
      });
    }
  }

  for (const [index, item] of rejections.entries()) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      await api(`/api/candidates/${item.candidate.issueNumber}/reject`, {
        method: "POST",
        body: JSON.stringify({
          reason: "Rejected through imported decision file.",
        }),
      });
      item.candidate.status = "rejected";
      rejected += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request failed";
      const rateLimited =
        error?.status === 429 ||
        message.toLowerCase().includes("secondary rate limit");
      if (rateLimited) {
        deferred = rejections.length - index;
        showNotice(
          `GitHub temporarily limited writes. Approved ${approvedCount}; rejected ${rejected}; ${deferred} rejections deferred. Upload the same file later to resume.`,
          "error",
        );
        break;
      }
      failures.push({
        arxiv_id: item.candidate.candidate_id,
        error: message,
      });
    }
  }
  elements["status-filter"].value = "pending";
  renderCandidates();
  renderCandidateCounts();
  const summary = `Approved ${approvedCount}; rejected ${rejected}; skipped ${skipped.length}; failed ${failures.length}; deferred ${deferred}.`;
  const details = failures
    .map(
      (failure) =>
        `${failure.arxiv_id ?? `entry ${failure.index}`}: ${failure.error}`,
    )
    .join(" ");
  showNotice(
    details ? `${summary} ${details}` : summary,
    failures.length ? "error" : "success",
  );
}

function text(tag, content, className = "") {
  const node = document.createElement(tag);
  node.textContent = content;
  if (className) node.className = className;
  return node;
}

function score(counts, multiplier) {
  if (!counts || !Number.isFinite(multiplier)) return null;
  return (
    multiplier *
    (counts.pages +
      6 * counts.theorems +
      4 * counts.lemmas +
      4 * counts.propositions +
      3 * counts.corollaries +
      2 * counts.definitions +
      counts.displayed_equations / 4 +
      counts.bibliography_entries / 10 +
      2 * counts.appendix_pages)
  );
}

function renderCandidates() {
  const query = elements.search.value.trim().toLowerCase();
  const status = elements["status-filter"].value;
  const candidates = state.candidates.filter((candidate) => {
    const haystack = [
      candidate.candidate_id,
      candidate.paper.title,
      ...candidate.paper.authors,
    ]
      .join(" ")
      .toLowerCase();
    return (
      (status === "all" || candidate.status === status) &&
      haystack.includes(query)
    );
  });
  elements["candidate-list"].replaceChildren();
  elements["empty-state"].hidden = candidates.length !== 0;

  for (const candidate of candidates) {
    const article = document.createElement("article");
    article.className = "candidate-row";
    const summary = document.createElement("div");
    summary.append(
      text("p", candidate.candidate_id, "candidate-id"),
      text("h3", candidate.paper.title),
      text("p", candidate.paper.authors.join(", "), "authors"),
    );
    const metadata = document.createElement("div");
    metadata.className = "candidate-meta";
    metadata.append(
      text("span", candidate.paper.primary_category),
      text(
        "span",
        candidate.status.replaceAll("-", " "),
        `status status--${candidate.status}`,
      ),
    );
    const button = text("button", "Review", "secondary-button");
    button.type = "button";
    button.disabled = candidate.status !== "pending";
    button.addEventListener("click", () => openReview(candidate));
    article.append(summary, metadata, button);
    elements["candidate-list"].append(article);
  }
}

function labeledInput(labelText, input) {
  const label = document.createElement("label");
  label.append(text("span", labelText), input);
  return label;
}

function openReview(candidate) {
  state.selected = candidate;
  elements["review-title"].textContent = candidate.paper.title;
  const content = elements["review-content"];
  content.replaceChildren();

  const facts = document.createElement("dl");
  facts.className = "review-facts";
  for (const [label, value] of [
    ["Authors", candidate.paper.authors.join(", ")],
    ["arXiv", candidate.candidate_id],
    ["Primary category", candidate.paper.primary_category],
    ["Submitted", candidate.paper.submitted],
  ]) {
    facts.append(text("dt", label), text("dd", value));
  }
  const keywords = [
    ...new Set(
      candidate.evidence.map((evidence) => evidence.term).filter(Boolean),
    ),
  ];
  const keywordList = document.createElement("ul");
  keywordList.className = "review-keywords";
  for (const keyword of keywords) keywordList.append(text("li", keyword));
  const keywordValue = document.createElement("dd");
  keywordValue.append(
    keywordList.childElementCount ? keywordList : text("span", "Not recorded"),
  );
  facts.append(text("dt", "Detected keywords"), keywordValue);
  content.append(facts);

  const form = document.createElement("form");
  form.className = "review-form";
  form.addEventListener("submit", submitApproval);
  candidate.evidence.forEach((evidence, index) => {
    const card = document.createElement("label");
    card.className = "evidence-card";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "evidenceIndex";
    radio.value = String(index + 1);
    radio.required = true;
    radio.addEventListener("change", () => fillEvidence(form, evidence));
    card.append(
      radio,
      text(
        "strong",
        `${evidence.term ?? `Passage ${index + 1}`} · ${evidence.location_value}`,
      ),
      text("blockquote", evidence.matched_sentence ?? evidence.quotation),
    );
    const pdfLink = text(
      "a",
      evidence.page ? `Open PDF page ${evidence.page}` : "Open PDF",
      "evidence-pdf-link",
    );
    pdfLink.href = `${
      candidate.paper.pdf_url ??
      `https://arxiv.org/pdf/${candidate.candidate_id}`
    }#page=${evidence.page ?? 1}`;
    pdfLink.target = "_blank";
    pdfLink.rel = "noopener noreferrer";
    form.append(card, pdfLink);
  });

  const quotation = document.createElement("textarea");
  quotation.name = "quotation";
  quotation.rows = 5;
  quotation.required = true;
  const locationKind = document.createElement("select");
  locationKind.name = "locationKind";
  locationKind.required = true;
  locationKind.append(
    new Option("PDF page", "page"),
    new Option("arXiv metadata", "metadata"),
  );
  const locationValue = document.createElement("input");
  locationValue.name = "locationValue";
  locationValue.required = true;
  const page = document.createElement("input");
  page.name = "page";
  page.type = "number";
  page.min = "1";
  const classification = document.createElement("select");
  classification.name = "classification";
  classification.required = true;
  classification.append(new Option("Select classification", ""));
  for (const [value, [label, fixedMultiplier]] of Object.entries(
    classifications,
  )) {
    const suffix =
      fixedMultiplier === null ? "reviewer-selected M" : `M=${fixedMultiplier}`;
    classification.append(new Option(`${label} — ${suffix}`, value));
  }
  const multiplier = document.createElement("input");
  multiplier.name = "multiplier";
  multiplier.type = "number";
  multiplier.min = "1";
  multiplier.max = "10";
  multiplier.step = "0.1";
  multiplier.required = true;
  const scorePreview = text(
    "output",
    "Select a classification",
    "score-preview",
  );
  classification.addEventListener("change", () => {
    const fixed = classifications[classification.value]?.[1];
    multiplier.value = fixed ?? "";
    multiplier.readOnly = fixed !== null && fixed !== undefined;
    updateScore(candidate, multiplier, scorePreview);
  });
  multiplier.addEventListener("input", () =>
    updateScore(candidate, multiplier, scorePreview),
  );

  const fields = document.createElement("div");
  fields.className = "form-grid";
  fields.append(
    labeledInput("Exact disclosure quotation", quotation),
    labeledInput("Location type", locationKind),
    labeledInput("Exact location", locationValue),
    labeledInput("PDF page", page),
    labeledInput("Disclosure classification", classification),
    labeledInput("Multiplier", multiplier),
  );
  form.append(fields, scorePreview);

  const actions = document.createElement("div");
  actions.className = "review-actions";
  const reject = text("button", "Reject candidate", "danger-button");
  reject.type = "button";
  reject.addEventListener("click", () => rejectCandidate(candidate));
  const approve = text("button", "Approve", "button");
  approve.type = "submit";
  actions.append(reject, approve);
  form.append(actions);
  content.append(form);
  elements["review-dialog"].showModal();
}

function fillEvidence(form, evidence) {
  form.elements.quotation.value = evidence.quotation;
  form.elements.locationKind.value = evidence.location_kind;
  form.elements.locationValue.value = evidence.location_value;
  form.elements.page.value = evidence.page ?? "";
  form.elements.page.disabled = evidence.location_kind === "metadata";
}

function updateScore(candidate, multiplierInput, output) {
  const value = score(
    candidate.analysis?.structural_counts,
    Number(multiplierInput.value),
  );
  output.textContent =
    value === null
      ? "Structural analysis unavailable"
      : `Slop Factor: ${value}`;
}

async function submitApproval(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await api(`/api/candidates/${state.selected.issueNumber}/approve`, {
      method: "POST",
      body: JSON.stringify({
        evidenceIndex: Number(data.get("evidenceIndex")),
        quotation: data.get("quotation"),
        locationKind: data.get("locationKind"),
        locationValue: data.get("locationValue"),
        page: data.get("page") || null,
        classification: data.get("classification"),
        multiplier: Number(data.get("multiplier")),
      }),
    });
    state.selected.status = "approved";
    state.approvedIds.add(state.selected.candidate_id);
    elements["status-filter"].value = "pending";
    elements["review-dialog"].close();
    renderCandidates();
    showNotice("Paper approved and front page update started.", "success");
    loadCandidates().catch((error) => showNotice(error.message, "error"));
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

async function rejectCandidate(candidate) {
  const reason = window.prompt(
    "Enter the factual reason this candidate is not eligible:",
  );
  if (!reason?.trim()) return;
  try {
    await api(`/api/candidates/${candidate.issueNumber}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
    elements["review-dialog"].close();
    showNotice(
      "Candidate rejected and removed from the pending queue.",
      "success",
    );
    await loadCandidates();
  } catch (error) {
    showNotice(error.message, "error");
  }
}

function renderCandidateCounts() {
  for (const status of ["pending", "rejected", "approved"]) {
    const id = `${status}-count`;
    elements[id].textContent = String(
      state.candidates.filter((item) => item.status === status).length,
    );
  }
}

async function loadCandidates() {
  const approved = await api("/api/approved-ids");
  state.approvedIds = new Set(approved.approved_ids);
  const candidates = [];
  for (let page = 1; ; page += 1) {
    const payload = await api(`/api/candidates?page=${page}`);
    candidates.push(
      ...payload.candidates.map((candidate) => ({
        ...candidate,
        status: state.approvedIds.has(candidate.candidate_id)
          ? "approved"
          : candidate.status,
      })),
    );
    if (!payload.has_more) break;
  }
  state.candidates = candidates;
  renderCandidateCounts();
  renderCandidates();
}

function renderScan(scan) {
  if (!scan) {
    elements["scan-session"].hidden = true;
    return;
  }
  elements["scan-session"].hidden = false;
  elements["scan-session"].dataset.status = scan.status;
  elements["scan-stage"].textContent = scan.stage;
  elements["scan-total"].textContent =
    scan.total === null ? "—" : String(scan.total);
  elements["scan-processed"].textContent = String(scan.processed);
  elements["scan-candidates"].textContent = String(scan.candidates);
  elements["scan-errors"].textContent = String(scan.errors);
  elements["scan-current"].textContent = scan.current || "";

  const progress = elements["scan-progress"];
  if (scan.total === null) {
    progress.removeAttribute("value");
    elements["scan-percent"].textContent = "—";
  } else {
    const ratio =
      scan.total === 0 ? 1 : Math.min(scan.processed / scan.total, 1);
    progress.value = ratio;
    elements["scan-percent"].textContent = `${Math.round(ratio * 100)}%`;
  }
}

async function loadScan() {
  const payload = await api("/api/scans/current");
  renderScan(payload.scan);
  if (state.scanTimer) clearTimeout(state.scanTimer);
  if (payload.scan && ["queued", "running"].includes(payload.scan.status)) {
    state.scanTimer = setTimeout(async () => {
      try {
        await loadScan();
      } catch (error) {
        showNotice(error.message, "error");
      }
    }, 5000);
  } else if (["completed", "failed"].includes(payload.scan?.status)) {
    await loadCandidates();
    await loadScanHistory();
  }
}

async function loadScanHistory(refreshAvailable = false) {
  const query = refreshAvailable
    ? "?refresh=available"
    : state.latestAvailable
      ? `?available=${encodeURIComponent(state.latestAvailable)}`
      : "";
  const payload = await api(`/api/scans/history${query}`);
  if (payload.latest_available)
    state.latestAvailable = payload.latest_available;
  elements["next-unscanned"].textContent =
    payload.next_unscanned ??
    (state.latestAvailable ? "Up to date" : "Refresh dates");
  elements["latest-arxiv-date"].textContent = state.latestAvailable ?? "—";
  elements["scanned-dates"].textContent = payload.scanned_dates.length
    ? payload.scanned_dates.join(", ")
    : "No completed dates.";
  if (state.latestAvailable) {
    for (const id of ["scan-start-date", "scan-end-date"]) {
      elements[id].max = state.latestAvailable;
    }
    if (refreshAvailable && payload.next_unscanned) {
      elements["scan-start-date"].value = payload.next_unscanned;
      elements["scan-end-date"].value = payload.next_unscanned;
    }
  }
}

async function initialize() {
  const today = new Date().toISOString().slice(0, 10);
  for (const id of ["scan-start-date", "scan-end-date"]) {
    elements[id].value = today;
    elements[id].max = today;
  }
  try {
    await api("/api/session");
    elements.account.hidden = false;
    elements.dashboard.hidden = false;
    await loadCandidates();
    await loadScan();
    await loadScanHistory();
  } catch (error) {
    if (error.message.includes("Authentication required")) {
      elements["login-panel"].hidden = false;
      return;
    }
    elements["login-panel"].hidden = false;
    showNotice(error.message, "error");
  }
}

document
  .getElementById("scan-form")
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      const data = new FormData(form);
      await api("/api/scan", {
        method: "POST",
        body: JSON.stringify({
          startDate: data.get("startDate"),
          endDate: data.get("endDate"),
        }),
      });
      showNotice("Scan queued.", "success");
      await loadScan();
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      button.disabled = false;
    }
  });

elements["refresh-available"].addEventListener("click", async () => {
  const button = elements["refresh-available"];
  button.disabled = true;
  try {
    await loadScanHistory(true);
    showNotice(`Latest release date: ${state.latestAvailable}.`, "success");
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    button.disabled = false;
  }
});
elements["scan-start-date"].addEventListener("change", () => {
  if (elements["scan-end-date"].value < elements["scan-start-date"].value) {
    elements["scan-end-date"].value = elements["scan-start-date"].value;
  }
});
document.getElementById("logout").addEventListener("click", async () => {
  await api("/auth/logout", { method: "POST", body: "{}" });
  window.location.reload();
});
elements["export-pending"].addEventListener("click", downloadPending);
elements["import-decisions"].addEventListener("click", () => {
  elements["decision-file"].click();
});
elements["update-front-page"].addEventListener("click", async () => {
  const button = elements["update-front-page"];
  button.disabled = true;
  try {
    await api("/api/site/deploy", { method: "POST", body: "{}" });
    showNotice("Front page update queued.", "success");
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    button.disabled = false;
  }
});
elements["decision-file"].addEventListener("change", async () => {
  const file = elements["decision-file"].files?.[0];
  if (!file) return;
  const button = elements["import-decisions"];
  button.disabled = true;
  try {
    await applyDecisionFile(file);
  } catch (error) {
    showNotice(error.message, "error");
  } finally {
    button.disabled = false;
    elements["decision-file"].value = "";
  }
});
elements.search.addEventListener("input", renderCandidates);
elements["status-filter"].addEventListener("change", renderCandidates);

initialize();
