from __future__ import annotations

from pipelines.ingestion.purpleair.client import PurpleAirClient


def test_parse_readings_happy_path() -> None:
    # This payload shape mirrors PurpleAir's `fields` + `data` format
    payload = {
        "fields": [
            "sensor_index",
            "last_seen",
            "pm2.5",
            "temperature",
            "humidity",
            "pressure",
            "latitude",
            "longitude",
        ],
        "data": [
            [12345, 1700000000, 12.3, 72.0, 40.0, 1010.0, 36.77, -119.41],
            [67890, 1700000600, None, None, None, None, 36.78, -119.42],
        ],
    }

    client = PurpleAirClient(api_key="dummy")
    readings = client.parse_readings(payload)

    assert len(readings) == 2

    r0 = readings[0]
    assert r0.sensor_id == 12345
    assert r0.ts == 1700000000
    assert r0.pm2_5 == 12.3
    assert r0.temperature_f == 72.0
    assert r0.humidity == 40.0
    assert r0.pressure == 1010.0
    assert r0.lat == 36.77
    assert r0.lon == -119.41

    r1 = readings[1]
    assert r1.sensor_id == 67890
    assert r1.ts == 1700000600
    assert r1.pm2_5 is None
    assert r1.temperature_f is None
    assert r1.humidity is None
    assert r1.pressure is None


def test_parse_readings_invalid_shape_raises() -> None:
    client = PurpleAirClient(api_key="dummy")

    bad_payload = {"fields": "not-a-list", "data": "not-a-list"}
    try:
        client.parse_readings(bad_payload)  # type: ignore[arg-type]
        assert False, "Expected RuntimeError"
    except RuntimeError:
        assert True
