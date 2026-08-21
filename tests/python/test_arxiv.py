from datetime import UTC, datetime

from slopfactor.arxiv import ArxivClient, parse_atom

ATOM = b"""<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/9999.99999v2</id>
    <updated>2099-01-02T00:00:00Z</updated>
    <published>2099-01-01T00:00:00Z</published>
    <title>Fictional paper</title>
    <summary>Fictional abstract.</summary>
    <author><name>A. Example</name></author>
    <arxiv:primary_category term="math.LO"/>
    <category term="math.LO"/><category term="math.CO"/>
    <arxiv:comment>Fictional comment.</arxiv:comment>
    <link href="http://arxiv.org/pdf/9999.99999v2" type="application/pdf"/>
  </entry>
</feed>"""


class Response:
    status = 200

    def __init__(self, payload: bytes) -> None:
        self.payload = payload

    def read(self) -> bytes:
        return self.payload


class Connection:
    def __init__(self, _host: str, timeout: int) -> None:
        self.timeout = timeout
        self.requests: list[str] = []

    def request(self, _method: str, path: str, headers: dict) -> None:
        assert headers["Connection"] == "keep-alive"
        self.requests.append(path)

    def getresponse(self) -> Response:
        return Response(ATOM)

    def close(self) -> None:
        pass


def test_parses_required_metadata_and_version() -> None:
    paper = parse_atom(ATOM)[0]

    assert paper.arxiv_id == "9999.99999"
    assert paper.version == 2
    assert paper.primary_category == "math.LO"
    assert paper.secondary_categories == ["math.CO"]
    assert paper.pdf_url.startswith("https://")


def test_reuses_connection_and_waits_three_seconds() -> None:
    current = [10.0]
    sleeps: list[float] = []

    def clock() -> float:
        return current[0]

    def sleep(seconds: float) -> None:
        sleeps.append(seconds)
        current[0] += seconds

    client = ArxivClient(
        user_agent="test",
        connection_factory=Connection,
        clock=clock,
        sleeper=sleep,
    )
    papers = list(
        client.query_recent(
            start=datetime(2098, 12, 31, tzinfo=UTC),
            end=datetime(2099, 1, 2, tzinfo=UTC),
            max_results=2,
            batch_size=1,
        )
    )

    assert len(papers) == 2
    assert sleeps == [3.0]
    assert len(client._connection.requests) == 2  # type: ignore[attr-defined]
