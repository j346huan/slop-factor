# Administrator guide

The administrator interface is a private GitHub issue queue operated through ChatGPT. Candidate
issues are never imported by the website, and discovery cannot run unless the queue repository is
private.

## ChatGPT commands

Use these requests in a ChatGPT conversation with the repository connected:

- `Scan today's math submissions.`
- `Scan 2026-08-15.`
- `Show pending papers.`
- `Review the next pending paper.`
- `Keep this paper pending.`
- `Reject this candidate.`
- `Approve this paper.`

For a dated scan, ChatGPT creates a private owner-authored issue titled
`Scan request: YYYY-MM-DD`. The workflow validates the date, closes the request when complete, and
adds each unique match to a private issue labeled `paper-candidate` and `candidate:pending`.

The Actions page also provides a **Run workflow** form. Leave the date blank for the rolling recent
window or enter an exact UTC arXiv submission date in `YYYY-MM-DD` format. The scheduled scan retains
the rolling window so delayed or updated submissions are not missed.

## Review and approval

Each pending issue contains:

- official arXiv metadata and source links;
- every candidate disclosure passage and its location;
- preliminary structural counts, methods, and fallback notes when analysis succeeds; and
- a reminder that automated matching is not an eligibility decision.

Before approval, the reviewer must confirm that the passage explicitly describes the authors' own AI
use, then confirm the exact quotation, location, classification, and multiplier. ChatGPT prepares an
approved JSON record on a feature branch, recalculates and validates the score, and opens a pull
request. Only merging that pull request can publish the paper.

Rejected candidates receive `candidate:rejected`; approved candidates receive `candidate:approved`.
Existing decisions are not reset if a later scan finds the same arXiv version again.

## Privacy boundary

Candidate issue bodies and workflow artifacts contain unpublished review material. Keep the queue
repository private and restrict repository access to administrators. The workflow verifies repository
privacy through the GitHub API before any scan and stops if the repository is public.

If the public site repository must be public for a GitHub Pages plan, move this workflow and all
candidate issues to a separate private administrator repository before changing visibility. The public
site repository should contain only code and approved records.
