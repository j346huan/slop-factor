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
  const byId = new Map(
    candidates.map((candidate) => [candidate.candidate_id, candidate]),
  );
  const seen = new Set();
  const decisions = [];
  const skipped = [];
  const errors = [];

  value.forEach((entry, index) => {
    let arxivId = "";
    try {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error(`Decision ${index + 1} must be a JSON object`);
      }
      arxivId = String(entry.arxiv_id ?? "").trim();
      const decision = String(entry.decision ?? "")
        .trim()
        .toLowerCase();
      if (!arxivId) throw new Error(`Decision ${index + 1} has no arxiv_id`);
      if (seen.has(arxivId)) {
        throw new Error(`Duplicate decision for ${arxivId}`);
      }
      seen.add(arxivId);
      const candidate = byId.get(arxivId);
      if (!candidate || candidate.status !== "pending") {
        skipped.push({ arxiv_id: arxivId, reason: "not pending" });
        return;
      }
      if (decision === "reject") {
        decisions.push({ candidate, decision });
        return;
      }
      if (decision !== "approve") {
        throw new Error(`${arxivId} decision must be approve or reject`);
      }

      const quotation = String(entry.quotation ?? "");
      const location = String(entry.location ?? "");
      const page = entry.page === null ? null : Number(entry.page);
      const classification = String(
        entry.disclosure_classification ?? "",
      ).trim();
      const multiplier = classifications[classification]?.[1];
      if (
        !quotation ||
        !location ||
        (page !== null && (!Number.isInteger(page) || page < 1))
      ) {
        throw new Error(
          `${arxivId} approval requires quotation, location, and page number or null`,
        );
      }
      if (!Number.isFinite(multiplier)) {
        throw new Error(
          `${arxivId} requires a fixed disclosure_classification from the specification`,
        );
      }
      const locationMatches = (evidence) =>
        evidence.location_value === location &&
        (page === null
          ? evidence.page === null || evidence.page === undefined
          : Number(evidence.page) === page);
      let evidenceIndex = candidate.evidence.findIndex(
        (evidence) => evidence.quotation === quotation && locationMatches(evidence),
      );
      if (evidenceIndex < 0) {
        evidenceIndex = candidate.evidence.findIndex(locationMatches);
      }
      if (evidenceIndex < 0) {
        throw new Error(
          `${arxivId} location and page do not match exported evidence`,
        );
      }
      decisions.push({
        candidate,
        decision,
        evidenceIndex: evidenceIndex + 1,
        quotation,
        location,
        page,
        locationKind: page === null ? "metadata" : "page",
        classification,
        multiplier,
      });
    } catch (error) {
      errors.push({
        arxiv_id: arxivId || null,
        index: index + 1,
        error: error.message,
      });
    }
  });

  return { decisions, skipped, errors };
}
