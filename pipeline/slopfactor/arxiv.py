"""A small, rate-limited client for the official arXiv Atom API."""

from __future__ import annotations

import http.client
import time
import urllib.parse
import xml.etree.ElementTree as ET
from collections.abc import Callable, Iterator
from dataclasses import asdict, dataclass
from datetime import UTC, datetime

ARXIV_HOST = "export.arxiv.org"
ATOM = "{http://www.w3.org/2005/Atom}"
ARXIV = "{http://arxiv.org/schemas/atom}"


@dataclass(frozen=True)
class ArxivPaper:
    arxiv_id: str
    version: int
    title: str
    authors: list[str]
    primary_category: str
    secondary_categories: list[str]
    submitted: str
    updated: str
    abstract: str
    comment: str
    abstract_url: str
    pdf_url: str
    source_url: str

    def to_dict(self) -> dict:
        return asdict(self)


def _text(entry: ET.Element, tag: str) -> str:
    node = entry.find(tag)
    return " ".join((node.text or "").split()) if node is not None else ""


def parse_atom(payload: bytes) -> list[ArxivPaper]:
    """Parse an arXiv Atom response into stable metadata records."""
    root = ET.fromstring(payload)
    papers: list[ArxivPaper] = []
    for entry in root.findall(f"{ATOM}entry"):
        raw_id = _text(entry, f"{ATOM}id").rsplit("/abs/", 1)[-1]
        if not raw_id:
            continue
        base_id, marker, version_text = raw_id.rpartition("v")
        if not marker or not version_text.isdigit():
            base_id, version = raw_id, 1
        else:
            version = int(version_text)
        primary_node = entry.find(f"{ARXIV}primary_category")
        primary = primary_node.attrib.get("term", "") if primary_node is not None else ""
        categories = [node.attrib.get("term", "") for node in entry.findall(f"{ATOM}category")]
        pdf_link = next(
            (
                link.attrib.get("href", "")
                for link in entry.findall(f"{ATOM}link")
                if link.attrib.get("type") == "application/pdf"
            ),
            f"https://arxiv.org/pdf/{raw_id}",
        )
        papers.append(
            ArxivPaper(
                arxiv_id=base_id,
                version=version,
                title=_text(entry, f"{ATOM}title"),
                authors=[_text(author, f"{ATOM}name") for author in entry.findall(f"{ATOM}author")],
                primary_category=primary,
                secondary_categories=[category for category in categories if category != primary],
                submitted=_text(entry, f"{ATOM}published"),
                updated=_text(entry, f"{ATOM}updated"),
                abstract=_text(entry, f"{ATOM}summary"),
                comment=_text(entry, f"{ARXIV}comment"),
                abstract_url=f"https://arxiv.org/abs/{base_id}v{version}",
                pdf_url=pdf_link.replace("http://", "https://"),
                source_url=f"https://export.arxiv.org/e-print/{base_id}v{version}",
            )
        )
    return papers


class ArxivClient:
    """Use one persistent connection and at least three seconds between API calls."""

    def __init__(
        self,
        *,
        user_agent: str,
        request_interval: float = 3.0,
        connection_factory: Callable[
            ..., http.client.HTTPSConnection
        ] = http.client.HTTPSConnection,
        clock: Callable[[], float] = time.monotonic,
        sleeper: Callable[[float], None] = time.sleep,
    ) -> None:
        if request_interval < 3.0:
            raise ValueError("The arXiv API request interval cannot be less than three seconds")
        self.user_agent = user_agent
        self.request_interval = request_interval
        self._connection = connection_factory(ARXIV_HOST, timeout=60)
        self._clock = clock
        self._sleeper = sleeper
        self._last_request_started: float | None = None

    def close(self) -> None:
        self._connection.close()

    def __enter__(self) -> ArxivClient:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def _request(self, parameters: dict[str, str | int]) -> bytes:
        if self._last_request_started is not None:
            elapsed = self._clock() - self._last_request_started
            if elapsed < self.request_interval:
                self._sleeper(self.request_interval - elapsed)
        self._last_request_started = self._clock()
        path = f"/api/query?{urllib.parse.urlencode(parameters)}"
        self._connection.request(
            "GET",
            path,
            headers={
                "Accept": "application/atom+xml",
                "Connection": "keep-alive",
                "User-Agent": self.user_agent,
            },
        )
        response = self._connection.getresponse()
        payload = response.read()
        if response.status != 200:
            raise RuntimeError(f"arXiv API returned HTTP {response.status}: {payload[:200]!r}")
        return payload

    def query_recent(
        self,
        *,
        start: datetime,
        end: datetime,
        max_results: int = 100,
        batch_size: int = 100,
    ) -> Iterator[ArxivPaper]:
        """Yield recent primary or secondary math submissions, filtering primary category later."""
        if start.tzinfo is None or end.tzinfo is None:
            raise ValueError("Query bounds must be timezone-aware")
        if max_results < 1 or batch_size < 1:
            return
        start_utc = start.astimezone(UTC).strftime("%Y%m%d%H%M")
        end_utc = end.astimezone(UTC).strftime("%Y%m%d%H%M")
        search = f"cat:math.* AND submittedDate:[{start_utc} TO {end_utc}]"
        offset = 0
        while offset < max_results:
            requested = min(batch_size, max_results - offset)
            payload = self._request(
                {
                    "search_query": search,
                    "start": offset,
                    "max_results": requested,
                    "sortBy": "submittedDate",
                    "sortOrder": "descending",
                }
            )
            batch = parse_atom(payload)
            if not batch:
                break
            yield from batch
            offset += len(batch)
            if len(batch) < requested:
                break
