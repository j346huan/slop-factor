export function buildPendingExport(candidates) {
  return candidates
    .filter((candidate) => candidate.status === "pending")
    .map((candidate) => ({
      arxiv_id: candidate.candidate_id,
      disclosures: candidate.evidence.map((evidence) => ({
        quotation: evidence.quotation,
        location: evidence.location_value,
        page: evidence.page ?? null,
      })),
    }));
}

export function validateDecisionInput(value, candidates, classifications) {
  if (!Array.isArray(value)) {
    throw new Error("Decision file must contain a JSON array");
  }
  const pending = new Map(
    candidates
      .filter((candidate) => candidate.status === "pending")
      .map((candidate) => [candidate.candidate_id, candidate]),
  );
  const seen = new Set();

  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Decision ${index + 1} must be a JSON object`);
    }
    const arxivId = String(entry.arxiv_id ?? "").trim();
    const decision = String(entry.decision ?? "").trim().toLowerCase();
    if (!arxivId) throw new Error(`Decision ${index + 1} has no arxiv_id`);
    if (seen.has(arxivId)) {
      throw new Error(`Duplicate decision for ${arxivId}`);
    }
    seen.add(arxivId);
    const candidate = pending.get(arxivId);
    if (!candidate) {
      throw new Error(`${arxivId} is not pending`);
    }
    if (decision === "reject") return { candidate, decision };
    if (decision !== "approve") {
      throw new Error(`${arxivId} decision must be approve or reject`);
    }

    const quotation = String(entry.quotation ?? "");
    const location = String(entry.location ?? "");
    const page = Number(entry.page);
    const classification = String(
      entry.disclosure_classification ?? "",
    ).trim();
    const multiplier = classifications[classification]?.[1];
    if (!quotation || !location || !Number.isInteger(page) || page < 1) {
      throw new Error(
        `${arxivId} approval requires quotation, location, and PDF page`,
      );
    }
    if (!Number.isFinite(multiplier)) {
      throw new Error(
        `${arxivId} requires a fixed disclosure_classification from the specification`,
      );
    }
    const evidenceIndex = candidate.evidence.findIndex(
      (evidence) =>
        evidence.quotation === quotation &&
        evidence.location_value === location &&
        Number(evidence.page) === page,
    );
    if (evidenceIndex < 0) {
      throw new Error(
        `${arxivId} quotation, location, and page do not match exported evidence`,
      );
    }
    return {
      candidate,
      decision,
      evidenceIndex: evidenceIndex + 1,
      quotation,
      location,
      page,
      classification,
      multiplier,
    };
  });
}
