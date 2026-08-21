# Administrator dashboard

Slop Factor includes a private browser-based administrator dashboard. It scans arXiv, manages the
candidate queue, records human review decisions, and prepares approval pull requests without using
ChatGPT, Codex, a language model, or an AI API.

The public site remains a static GitHub Pages build. The administrator dashboard is served by a free
Cloudflare Worker because GitHub Pages cannot securely hold GitHub credentials or provide private
authentication. Candidate state remains in private GitHub issues; the Worker has no database.

## Administrator workflow

1. Sign in to the dashboard with the configured GitHub administrator account.
2. Select today's UTC date or any past date and start a deterministic arXiv scan.
3. Review matched passages and preliminary structural counts in the private pending queue.
4. Reject an ineligible match with a factual reason, or select the exact disclosure passage.
5. Confirm the quotation, location, classification, multiplier, and rationale.
6. Type `APPROVE`. The dashboard starts a GitHub Actions workflow that validates the record and opens
   an approval pull request.
7. Review and merge the approval pull request to publish the paper.

Automated discovery never writes approved data. Approval never pushes directly to `main`.

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

Install the app only on the `slop-factor` repository. GitHub App permissions keep the dashboard scoped
to that repository instead of granting access to the administrator's other repositories. Copy the
generated Client ID and create a Client Secret.

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

The scan and approval workflows must exist on the default branch before the dashboard can dispatch
them. After validation passes, merge the application pull request and wait for the public-site and
administrator deployments to complete.

## Security boundary

- OAuth tokens are encrypted into secure, HTTP-only, same-site cookies and are never stored in the
  browser's local storage or repository.
- Every API request verifies the configured GitHub username and repository administrator permission.
- Mutation requests require a same-origin browser request.
- Candidate issues and reports remain in a private repository.
- The Worker stops candidate discovery if the queue repository is public.
- No secrets or candidate records are included in the production public-site build.

If the public GitHub Pages repository must become public, move candidate issues and the discovery and
approval workflows to a separate private administrator repository before changing visibility.
