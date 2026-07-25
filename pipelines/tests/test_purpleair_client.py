from __future__ import annotations

from pipelines.ingestion.purpleair.client import PurpleAirClient

POLL_TS = 1700001000


def test_parse_readings_happy_path() -> None:
    payload = {
        "fields": [
            "sensor_index",
            "last_seen",
            "pm2.5_cf_1_a",
            "pm2.5_cf_1_b",
            "humidity",
            "temperature",
        ],
        "data": [
            [12345, 1700000000, 12.3, 11.9, 40.0, 72.0],
            [67890, 1700000600, None, None, None, None],
        ],
    }

    client = PurpleAirClient(api_key="dummy")
    readings = client.parse_readings(payload, poll_ts=POLL_TS)

    assert len(readings) == 2

    r0 = readings[0]
    assert r0.sensor_index == 12345
    assert r0.ts_utc == POLL_TS
    assert r0.last_seen == 1700000000
    assert r0.pm25_cf1_a == 12.3
    assert r0.pm25_cf1_b == 11.9
    assert r0.humidity_a == 40.0
    assert r0.temperature_f == 72.0

    r1 = readings[1]
    assert r1.sensor_index == 67890
    assert r1.last_seen == 1700000600
    assert r1.pm25_cf1_a is None
    assert r1.pm25_cf1_b is None
    assert r1.humidity_a is None
    assert r1.temperature_f is None


def test_parse_readings_invalid_shape_raises() -> None:
    client = PurpleAirClient(api_key="dummy")
    bad_payload = {"fields": "not-a-list", "data": "not-a-list"}
    try:
        client.parse_readings(bad_payload, poll_ts=POLL_TS)  # type: ignore[arg-type]
        assert False, "Expected RuntimeError"
    except RuntimeError:
        assert True
