import fs from "node:fs";
import { fileURLToPath } from "node:url";

import type { ApprovedPaper, ApprovedPaperCollection } from "./types";

const approvedDataPath = fileURLToPath(
  new URL("../../data/approved/papers.json", import.meta.url),
);

export function getApprovedPapers(): ApprovedPaper[] {
  const collection = JSON.parse(
    fs.readFileSync(approvedDataPath, "utf8"),
  ) as ApprovedPaperCollection;

  if (collection.schema_version !== 1 || !Array.isArray(collection.papers)) {
    throw new Error(
      "Approved paper data has an unsupported collection schema.",
    );
  }

  for (const paper of collection.papers) {
    if (paper.verification?.status !== "verified") {
      throw new Error(
        `Unverified record entered the public build: ${paper.arxiv_id}`,
      );
    }
    if (!paper.categories?.primary?.startsWith("math.")) {
      throw new Error(
        `Non-mathematics primary category entered the public build: ${paper.arxiv_id}`,
      );
    }
    if (!paper.disclosure?.quotation || !paper.disclosure?.location?.value) {
      throw new Error(`Disclosure evidence is incomplete: ${paper.arxiv_id}`);
    }
  }

  return collection.papers;
}
