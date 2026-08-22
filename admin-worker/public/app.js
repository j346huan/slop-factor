const state = { candidates: [], selected: null, scanTimer: null };
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
    "empty-state",
    "login-panel",
    "notice",
    "next-unscanned",
    "pending-count",
    "rejected-count",
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
    "submitted-count",
  ].map((id) => [id, document.getElementById(id)]),
);

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
  const payload = response.headers.get("Content-Type")?.includes("json")
    ? await response.json()
    : { error: await response.text() };
  if (!response.ok)
    throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

function showNotice(message, tone = "info") {
  elements.notice.textContent = message;
  elements.notice.dataset.tone = tone;
  elements.notice.hidden = false;
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
    const suffix = fixedMultiplier === null ? "reviewer-selected M" : `M=${fixedMultiplier}`;
    classification.append(new Option(`${label} — ${suffix}`, value));
  }
  const multiplier = document.createElement("input");
  multiplier.name = "multiplier";
  multiplier.type = "number";
  multiplier.min = "1";
  multiplier.max = "10";
  multiplier.step = "0.1";
  multiplier.required = true;
  const rationale = document.createElement("textarea");
  rationale.name = "rationale";
  rationale.rows = 3;
  rationale.required = true;
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
    labeledInput("Classification rationale", rationale),
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
        rationale: data.get("rationale"),
      }),
    });
    elements["review-dialog"].close();
    showNotice(
      "Approval workflow started. A pull request will appear after validation passes.",
      "success",
    );
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

async function loadCandidates() {
  const payload = await api("/api/candidates");
  state.candidates = payload.candidates;
  for (const status of [
    "pending",
    "approval-submitted",
    "rejected",
    "approved",
  ]) {
    const id =
      status === "approval-submitted" ? "submitted-count" : `${status}-count`;
    elements[id].textContent = String(
      state.candidates.filter((item) => item.status === status).length,
    );
  }
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
    await Promise.all([loadCandidates(), loadScanHistory()]);
  }
}

async function loadScanHistory() {
  const payload = await api("/api/scans/history");
  elements["next-unscanned"].textContent = payload.next_unscanned ?? "Up to date";
  elements["scanned-dates"].textContent = payload.scanned_dates.length
    ? payload.scanned_dates.join(", ")
    : "No completed dates.";
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
    await Promise.all([loadCandidates(), loadScan(), loadScanHistory()]);
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

document.getElementById("refresh").addEventListener("click", async () => {
  await Promise.all([loadCandidates(), loadScan(), loadScanHistory()]);
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
elements.search.addEventListener("input", renderCandidates);
elements["status-filter"].addEventListener("change", renderCandidates);

initialize();
