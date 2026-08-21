from datetime import UTC, date, datetime
from pathlib import Path

from slopfactor.discovery import date_query_bounds, discover
from slopfactor.state import read_last_success, record_success


def test_records_last_successful_query_and_skips_redundant_work(tmp_path: Path) -> None:
    state = tmp_path / "state.json"
    output = tmp_path / "candidates.json"
    queried_at = datetime(2099, 1, 1, 12, tzinfo=UTC)
    record_success(state, queried_at=queried_at, window_start=queried_at, papers_seen=4)

    report = discover(
        output=output,
        state_path=state,
        download_directory=tmp_path / "downloads",
        now=datetime(2099, 1, 1, 13, tzinfo=UTC),
    )

    assert read_last_success(state) == queried_at
    assert report["skipped"] is True
    assert report["candidates"] == []
    assert output.is_file()


def test_exact_date_uses_full_utc_day_or_current_time() -> None:
    now = datetime(2099, 1, 3, 12, 30, tzinfo=UTC)

    past_start, past_end = date_query_bounds(date(2099, 1, 2), now)
    current_start, current_end = date_query_bounds(date(2099, 1, 3), now)

    assert past_start == datetime(2099, 1, 2, tzinfo=UTC)
    assert past_end == datetime(2099, 1, 3, tzinfo=UTC)
    assert current_start == datetime(2099, 1, 3, tzinfo=UTC)
    assert current_end == now
