# Administrator dashboard

Slop Factor includes a private browser-based administrator dashboard. It scans arXiv, manages the
candidate queue, records human review decisions, and publishes approved records without using
ChatGPT, Codex, a language model, or an AI API.

The public site remains a static GitHub Pages build. The administrator dashboard is served by a free
Cloudflare Worker because GitHub Pages cannot securely hold GitHub credentials or provide private
authentication. Candidate state remains in private GitHub issues in `j346huan/slop-factor-admin`;
the Worker has no database. Approved records and the public website remain in
`j346huan/slop-factor`.

## Administrator workflow

1. Sign in to the dashboard with the configured GitHub administrator account.
2. Select an arXiv release date or date range and start a deterministic scan.
3. Review matched passages and preliminary structural counts in the private pending queue.
4. Reject an ineligible match with a factual reason, or select the exact disclosure passage.
5. Confirm the quotation, location, classification, and multiplier, then click **Approve**.
6. The approved record is validated, published, and deployed automatically.

Automated discovery never writes approved data. Only an explicit human approval publishes a record.

## JSON batch decisions

Use **Output pending** to download every pending arXiv ID and its detected disclosure passages. Complete a decision file and use **Input decisions** to apply approvals and rejections. The exact schema and supported classifications are in [`DECISION_IMPORT_SPEC.md`](DECISION_IMPORT_SPEC.md).

## One-time deployment setup

### 1. Create the GitHub App

In GitHub, open **Settings → Developer settings → GitHub Apps → New GitHub App**.

- GitHub App name: `Slop Factor Administrator`
- Homepage URL: the Worker URL assigned after the first deployment
- Callback URL: `https://YOUR-WORKER-URL/auth/callback`
- Webhook: inactive
- Actions permission: read and write
- Issues permission: read and write
- Metadata permission: read-only

Install the app only on the `slop-factor` and `slop-factor-admin` repositories. GitHub App permissions
keep the dashboard scoped to those two repositories instead of granting access to the administrator's
other repositories. Copy the generated Client ID and create a Client Secret.

### 2. Create the Cloudflare Worker

Create a free Cloudflare account and connect this repository to Workers Builds, using:

- Deploy command: `npx wrangler deploy --config admin-worker/wrangler.jsonc`
- Root directory: `/`

Alternatively, configure the included `Deploy administrator dashboard` GitHub Action with repository
secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

In the Worker settings, add these encrypted secrets:

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `SESSION_SECRET` — a long random value used to encrypt HTTP-only session cookies

The non-secret repository and administrator settings are already defined in
`admin-worker/wrangler.jsonc`.

### 3. Link the public site

Create the GitHub repository variable `PUBLIC_ADMIN_URL` with the final Worker URL. The next public-site
deployment adds an **Administrator** navigation link.

### 4. Merge the application pull request

Merge the private administrator repository pull request first, then merge the public application pull
request. The scan workflow must exist on the private repository's default branch and the approval
workflow must exist on the public repository's default branch before the dashboard can dispatch them.
Wait for the public-site and administrator deployments to complete.

## Security boundary

- OAuth tokens are encrypted into secure, HTTP-only, same-site cookies and are never stored in the
  browser's local storage or repository.
- Every API request verifies the configured GitHub username and repository administrator permission.
- Mutation requests require a same-origin browser request.
- Candidate issues, scan logs, and reports remain in `slop-factor-admin`, which must remain private.
- The Worker stops candidate discovery if the queue repository is public.
- No secrets or candidate records are included in the production public-site build.

The public repository contains the approval workflow because only human-confirmed records are sent to
it. Automated candidates never enter the public repository.
