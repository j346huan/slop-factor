from datetime import date

import pytest
from slopfactor.admin import resolve_scan_parameters


def test_resolves_exact_manual_date() -> None:
    manual = resolve_scan_parameters(
        event_name="workflow_dispatch",
        manual_date="2099-01-02",
        max_results="75",
        today=date(2099, 1, 3),
    )
    assert manual.scan_date == date(2099, 1, 2)
    assert manual.max_results == 75


def test_schedule_keeps_rolling_window() -> None:
    parameters = resolve_scan_parameters(event_name="schedule", today=date(2099, 1, 3))

    assert parameters.scan_date is None


@pytest.mark.parametrize(
    ("event_name", "manual_date", "max_results"),
    [
        ("workflow_dispatch", "2099-01-04", "50"),
        ("workflow_dispatch", "", "0"),
    ],
)
def test_rejects_invalid_or_future_scan_requests(
    event_name: str, manual_date: str, max_results: str
) -> None:
    with pytest.raises(ValueError):
        resolve_scan_parameters(
            event_name=event_name,
            manual_date=manual_date,
            max_results=max_results,
            today=date(2099, 1, 3),
        )
