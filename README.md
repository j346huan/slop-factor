# Slop Factor

Slop Factor is a static, review-first data tracker for mathematics papers whose authors explicitly
disclose using AI or a large language model. The project records structural document characteristics;
it does not infer AI use and does not assess mathematical quality.

## Public inclusion standard

A record can enter `data/approved/papers.json` only when:

1. its primary arXiv category begins with `math.`;
2. the paper or official arXiv metadata explicitly discloses author use of AI or an LLM;
3. a human reviewer verifies that disclosure; and
4. the exact quotation and its location are recorded.

Automated matches are private review candidates. They never enter the public website automatically.
The JSON Schema at `data/schema/approved-paper.schema.json` rejects incomplete or additional fields,
and semantic validation recalculates every score.

## Score

The unbounded score is

```text
Slop Factor = M × (P + 6T + 4L + 4Q + 3C + 2D + E/4 + R/10 + 2A)
```

where `P` is pages, `T` theorems, `L` lemmas, `Q` propositions, `C` corollaries,
`D` definitions, `E` displayed equations, `R` bibliography entries, and `A` appendix pages.
The disclosure multiplier `M` is 1 for proofreading/grammar/translation, 2 for
brainstorming/literature assistance/code, 5 for rewriting or drafting portions, and 10 for substantial
text/proof/content generation. The highest applicable disclosed use controls, with a documented
intermediate multiplier available when needed.

The score is not normalized and is not an AI probability.

## Architecture

- Astro and TypeScript generate the complete site as static files.
- The production build reads only the version-controlled approved JSON collection.
- Python queries the official arXiv API, finds review candidates, safely analyzes source archives,
  falls back to extracted PDF text when needed, and performs explicit local approval.
- GitHub Actions validates changes, deploys GitHub Pages after validated changes reach `main`, and
  produces a private daily candidate artifact without committing it.
- No database, server application, paid API, detector, credential, or custom domain is required.

Astro derives its GitHub Pages base path from `GITHUB_REPOSITORY`, so the build works under a project
path such as `https://USERNAME.github.io/slop-factor/`. Set `SITE_BASE=/slop-factor/` to reproduce that
path locally during a build.

## Local setup

Requirements: Node.js 20 or newer, Python 3.11 or newer, `pdftotext`, and `pdfinfo` (both provided by
Poppler).

```bash
npm ci
python -m pip install -e '.[dev]'
npm run dev
```

Run the complete local validation suite:

```bash
python scripts/validate_approved.py
ruff check pipeline scripts tests/python
ruff format --check pipeline scripts tests/python
npm run format
npm run lint
npm run check
pytest
npm test
npm run build
```

## Candidate discovery and administrator queue

The client uses one persistent connection for the official arXiv Atom API and starts requests at least
three seconds apart. It records the last successful query in an ignored local state file so repeated
runs can skip redundant work. PDF and source downloads are also sequential and rate limited.

```bash
python scripts/discover_candidates.py \
  --output private/candidates/recent.json \
  --state private/state/last-query.json
```

Scan one exact UTC arXiv submission date with `--date YYYY-MM-DD`. Exact-date scans bypass the rolling
query cooldown without changing its last-success state.

Discovery searches official metadata and page-separated PDF text for terms including ChatGPT, Claude,
Gemini, LLM, large language model, and generative AI. Conservative context rules remove obvious
bibliography entries, general discussions, and statements of non-use where possible. Every surviving
match remains an unreviewed candidate.

Candidate JSON, downloaded papers, and query state under `private/` are ignored by Git and excluded
from the Astro import graph. The workflow uploads the report as a restricted Actions artifact and
synchronizes unique matches into a persistent private GitHub issue queue. It verifies repository
privacy before scanning and does not run against a public repository. Repository and Actions access
should be limited to the administrators responsible for review.

ChatGPT can request an exact-date scan by creating a private owner-authored issue titled
`Scan request: YYYY-MM-DD`, list issues labeled `candidate:pending`, and guide the explicit review.
The same date field is available under **Actions → Private candidate discovery → Run workflow**.
See [the administrator guide](ADMIN_GUIDE.md) for the no-code workflow and privacy boundary.

## Structural analysis and approval

Source analysis rejects absolute paths, path traversal, links, special files, excessive member counts,
and oversized extracted content. It expands the primary TeX document and counts theorem-like
environments, displayed-equation environments, and bibliography entries. PDF metadata supplies total
pages, while page-separated PDF text estimates the appendix boundary. If source is unavailable or
unparseable, theorem-like headings, displayed equations, and references are estimated from PDF text.
Every approved record stores per-count provenance and notes.

Review one candidate locally:

```bash
python scripts/approve_candidate.py \
  --report private/candidates/recent.json \
  --candidate 2501.01234v2 \
  --reviewer REVIEWER_HANDLE
```

The command displays the candidate passage and context, requires the reviewer to type `APPROVE`, asks
for the exact quotation, location confirmation, and disclosure classification, downloads or accepts
local document assets, recalculates the score, then requires `WRITE` before changing approved data.
Run the validator and inspect the resulting diff before committing.

## Workflows

- `validation.yml` runs data validation, Python tests and Ruff, frontend tests, ESLint, Prettier, Astro
  type checks, and the production build on pushes and pull requests.
- `pages.yml` validates approved data, builds the static site with the repository base path, and deploys
  to GitHub Pages only after changes reach `main`.
- `candidate-discovery.yml` runs daily at 04:17 UTC, on manual dispatch, and for validated private scan
  requests. It can write only private candidate issues; it cannot write repository contents, change
  approved data, or deploy.

Configure the repository’s Pages source as **GitHub Actions**. Branch protection requiring the
validation workflow is recommended for `main`.

## Corrections

Corrections to disclosure text, location, classification, source counts, metadata, or paper version
should be submitted as a reviewable change with supporting arXiv evidence. Version control preserves
the prior record history. Inclusion is not criticism of a paper or its authors.
