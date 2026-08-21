"""Private GitHub issue queue for unpublished review candidates."""

from __future__ import annotations

import base64
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass

CANDIDATE_LABEL = "paper-candidate"
PENDING_LABEL = "candidate:pending"
APPROVED_LABEL = "candidate:approved"
REJECTED_LABEL = "candidate:rejected"
SUBMITTED_LABEL = "candidate:approval-submitted"
QUEUE_LABELS = {
    CANDIDATE_LABEL: ("59636e", "Private AI-disclosure review candidate"),
    PENDING_LABEL: ("d4a72c", "Awaiting human review"),
    APPROVED_LABEL: ("2f6f55", "Human reviewer approved the disclosure"),
    REJECTED_LABEL: ("7b8491", "Human reviewer rejected or excluded the candidate"),
    SUBMITTED_LABEL: ("4267b2", "An approval pull request is awaiting review"),
}

PAYLOAD = re.compile(r"<!-- slop-factor-payload:([A-Za-z0-9_-]+) -->")


def candidate_marker(candidate_id: str) -> str:
    return f"<!-- slop-factor-candidate:{candidate_id} -->"


def encode_candidate_payload(candidate: dict) -> str:
    serialized = json.dumps(candidate, ensure_ascii=False, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(serialized).decode().rstrip("=")


def decode_candidate_payload(body: str) -> dict:
    match = PAYLOAD.search(body)
    if match is None:
        raise ValueError("Candidate issue does not contain a machine-readable review payload")
    encoded = match.group(1)
    padding = "=" * (-len(encoded) % 4)
    payload = json.loads(base64.urlsafe_b64decode(encoded + padding))
    if not isinstance(payload, dict) or not payload.get("candidate_id"):
        raise ValueError("Candidate issue contains an invalid review payload")
    return payload


def decode_candidate_argument(value: str) -> dict:
    """Decode a URL-safe candidate payload transferred after human approval."""
    padding = "=" * (-len(value) % 4)
    candidate = json.loads(base64.urlsafe_b64decode(value + padding))
    if not isinstance(candidate, dict) or not candidate.get("candidate_id"):
        raise ValueError("Candidate payload is invalid")
    return candidate


def _quote(text: str) -> str:
    return "\n".join(f"> {line}" if line else ">" for line in text.splitlines())


def candidate_issue_body(candidate: dict, report: dict) -> str:
    """Render a neutral review packet without making an eligibility claim."""
    paper = candidate["paper"]
    query = report.get("query", {})
    lines = [
        candidate_marker(candidate["candidate_id"]),
        f"<!-- slop-factor-payload:{encode_candidate_payload(candidate)} -->",
        "## Candidate metadata",
        "",
        f"- **Title:** {paper['title']}",
        f"- **Authors:** {', '.join(paper['authors'])}",
        f"- **arXiv:** [{candidate['candidate_id']}]({paper['abstract_url']})",
        f"- **Primary category:** {paper['primary_category']}",
        f"- **Secondary categories:** {', '.join(paper['secondary_categories']) or 'None'}",
        f"- **Submitted:** {paper['submitted']}",
        f"- **Scan window:** {query.get('window_start', 'Unknown')} to "
        f"{query.get('window_end', 'Unknown')}",
        "",
        "## Candidate disclosure passages",
        "",
        "Automated matching only. A human reviewer must verify that a passage explicitly discloses "
        "the authors’ own use of AI before approval.",
    ]
    for index, evidence in enumerate(candidate["evidence"], start=1):
        lines.extend(
            [
                "",
                f"### Passage {index}",
                "",
                f"**Location:** {evidence['location_value']}",
                "",
                _quote(evidence["quotation"]),
            ]
        )

    analysis = candidate.get("analysis")
    if analysis:
        counts = analysis["structural_counts"]
        methods = analysis["count_methods"]
        labels = {
            "pages": "Pages",
            "theorems": "Theorems",
            "lemmas": "Lemmas",
            "propositions": "Propositions",
            "corollaries": "Corollaries",
            "definitions": "Definitions",
            "displayed_equations": "Displayed equations",
            "bibliography_entries": "Bibliography entries",
            "appendix_pages": "Appendix pages",
        }
        lines.extend(
            [
                "",
                "## Preliminary structural analysis",
                "",
                "| Measure | Count | Method |",
                "| --- | ---: | --- |",
            ]
        )
        for key, label in labels.items():
            lines.append(f"| {label} | {counts[key]} | {methods[key]} |")
        if analysis.get("count_notes"):
            lines.extend(["", "**Analysis notes:**"])
            lines.extend(f"- {note}" for note in analysis["count_notes"])
    else:
        lines.extend(
            [
                "",
                "## Preliminary structural analysis",
                "",
                "Analysis was not available during discovery and must be completed before "
                "approval.",
            ]
        )

    lines.extend(
        [
            "",
            "## Required human decision",
            "",
            "Confirm the exact quotation, location, disclosure classification, and multiplier. "
            "Inclusion is not criticism of the paper or its authors.",
        ]
    )
    return "\n".join(lines) + "\n"


@dataclass(frozen=True)
class QueueResult:
    created: int = 0
    updated: int = 0
    unchanged: int = 0


class GitHubIssueClient:
    """Minimal GitHub REST client limited to the private candidate issue queue."""

    def __init__(
        self,
        *,
        repository: str,
        token: str,
        opener: Callable[..., object] = urllib.request.urlopen,
    ) -> None:
        if repository.count("/") != 1:
            raise ValueError("Repository must use owner/name format")
        if not token:
            raise ValueError("A GitHub token is required")
        self.repository = repository
        self.token = token
        self._opener = opener

    def request(self, method: str, path: str, payload: dict | None = None) -> object:
        body = json.dumps(payload).encode() if payload is not None else None
        request = urllib.request.Request(
            f"https://api.github.com{path}",
            data=body,
            method=method,
            headers={
                "Accept": "application/vnd.github+json",
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
                "User-Agent": "slop-factor-private-admin-queue/0.1",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        )
        try:
            response = self._opener(request, timeout=60)
            with response:
                content = response.read()
        except urllib.error.HTTPError as error:
            details = error.read().decode("utf8", errors="replace")
            raise RuntimeError(f"GitHub API returned HTTP {error.code}: {details[:500]}") from error
        return json.loads(content) if content else {}

    def assert_private(self) -> None:
        metadata = self.request("GET", f"/repos/{self.repository}")
        if not isinstance(metadata, dict) or metadata.get("private") is not True:
            raise PermissionError(
                "Candidate discovery is disabled because the pending queue repository is not "
                "private"
            )

    def ensure_labels(self) -> None:
        for name, (color, description) in QUEUE_LABELS.items():
            encoded = urllib.parse.quote(name, safe="")
            try:
                self.request("GET", f"/repos/{self.repository}/labels/{encoded}")
            except RuntimeError as error:
                if "HTTP 404" not in str(error):
                    raise
                self.request(
                    "POST",
                    f"/repos/{self.repository}/labels",
                    {"name": name, "color": color, "description": description},
                )

    def candidate_issues(self) -> dict[str, dict]:
        issues: dict[str, dict] = {}
        page = 1
        while True:
            encoded = urllib.parse.quote(CANDIDATE_LABEL, safe="")
            batch = self.request(
                "GET",
                f"/repos/{self.repository}/issues?state=all&labels={encoded}&per_page=100&page={page}",
            )
            if not isinstance(batch, list):
                raise RuntimeError("GitHub returned an invalid issue list")
            for issue in batch:
                body = issue.get("body") or ""
                for line in body.splitlines():
                    if line.startswith("<!-- slop-factor-candidate:") and line.endswith(" -->"):
                        issues[
                            line.removeprefix("<!-- slop-factor-candidate:").removesuffix(" -->")
                        ] = issue
                        break
            if len(batch) < 100:
                break
            page += 1
        return issues

    def sync_report(self, report: dict) -> QueueResult:
        self.assert_private()
        self.ensure_labels()
        existing = self.candidate_issues()
        created = updated = unchanged = 0
        for candidate in report.get("candidates", []):
            candidate_id = candidate["candidate_id"]
            body = candidate_issue_body(candidate, report)
            current = existing.get(candidate_id)
            if current is None:
                self.request(
                    "POST",
                    f"/repos/{self.repository}/issues",
                    {
                        "title": f"Pending review: arXiv {candidate_id}",
                        "body": body,
                        "labels": [CANDIDATE_LABEL, PENDING_LABEL],
                    },
                )
                created += 1
                continue
            label_names = {label["name"] for label in current.get("labels", [])}
            if {APPROVED_LABEL, REJECTED_LABEL, SUBMITTED_LABEL} & label_names:
                unchanged += 1
                continue
            if current.get("body") == body:
                unchanged += 1
                continue
            self.request(
                "PATCH",
                f"/repos/{self.repository}/issues/{current['number']}",
                {"body": body},
            )
            updated += 1
        return QueueResult(created=created, updated=updated, unchanged=unchanged)
