from __future__ import annotations

from typing import Any

import requests
from requests import Response
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from pipelines.common.logging_setup import get_logger

logger = get_logger(__name__)


class TransientHTTPError(RuntimeError):
    pass


def _is_transient_status(status_code: int) -> bool:
    # Retry on throttling and common transient server errors
    return status_code in {429, 500, 502, 503, 504}


@retry(
    retry=retry_if_exception_type((requests.RequestException, TransientHTTPError)),
    wait=wait_exponential(multiplier=0.5, min=0.5, max=10),
    stop=stop_after_attempt(5),
    reraise=True,
)
def get_json(
    url: str,
    headers: dict[str, str] | None = None,
    params: dict[str, Any] | None = None,
    timeout_s: float = 20.0,
) -> dict[str, Any]:
    """
    GET a JSON response with retries and safe defaults.
    """
    resp: Response = requests.get(url, headers=headers, params=params, timeout=timeout_s)

    if _is_transient_status(resp.status_code):
        logger.warning(
            "Transient HTTP status",
            extra={"url": url, "status_code": resp.status_code},
        )
        raise TransientHTTPError(f"Transient status code: {resp.status_code}")

    resp.raise_for_status()

    try:
        return resp.json()
    except Exception as e:
        raise RuntimeError(f"Non-JSON response from {url}: {e}") from e
