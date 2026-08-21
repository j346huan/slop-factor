"""Polite, sequential downloads of arXiv paper assets."""

from __future__ import annotations

import time
import urllib.request
from collections.abc import Callable
from pathlib import Path


class DownloadClient:
    """Download one asset at a time with a configurable courtesy interval."""

    def __init__(
        self,
        *,
        user_agent: str,
        request_interval: float = 3.0,
        clock: Callable[[], float] = time.monotonic,
        sleeper: Callable[[float], None] = time.sleep,
        opener: Callable[..., object] = urllib.request.urlopen,
    ) -> None:
        if request_interval < 3.0:
            raise ValueError("The arXiv download interval cannot be less than three seconds")
        self.user_agent = user_agent
        self.request_interval = request_interval
        self._clock = clock
        self._sleeper = sleeper
        self._opener = opener
        self._last_request_started: float | None = None

    def download(self, url: str, destination: Path, *, max_bytes: int = 75 * 1024 * 1024) -> Path:
        if self._last_request_started is not None:
            elapsed = self._clock() - self._last_request_started
            if elapsed < self.request_interval:
                self._sleeper(self.request_interval - elapsed)
        self._last_request_started = self._clock()

        request = urllib.request.Request(
            url,
            headers={"Accept": "*/*", "User-Agent": self.user_agent},
            method="GET",
        )
        response = self._opener(request, timeout=90)
        destination.parent.mkdir(parents=True, exist_ok=True)
        total = 0
        temporary = destination.with_suffix(f"{destination.suffix}.part")
        try:
            with response, temporary.open("wb") as output:
                while chunk := response.read(1024 * 1024):
                    total += len(chunk)
                    if total > max_bytes:
                        raise ValueError(f"Download exceeds {max_bytes} bytes: {url}")
                    output.write(chunk)
            temporary.replace(destination)
        finally:
            temporary.unlink(missing_ok=True)
        return destination
