# CLAUDE.md — Healthy Fresno Air (HFA)

This file is standing context for any Claude Code session working in this repo. Read it before making changes. If something here conflicts with what you find in the code, the code is more current on implementation details — but the *decisions* in this file are the ones that were deliberately reversed after real investigation, so don't silently "fix" the code back to an older pattern (e.g. don't reintroduce Postgres/PostGIS — that was tried and reversed, see §2).

**Source of truth, in order:** this file → `docs/product_spec_v2.md` → `docs/data_contract.md`.

---

## 1. What this project is

A map-first air quality intelligence platform for Fresno County, in the pattern of Reventure.app applied to air quality. Built by a nonprofit currently running a POC on existing public PurpleAir sensors, with a planned transition to nonprofit-owned sensors post-POC. **Currently in test mode, not production.**

**Primary goal: fastest path to a real, working product to validate with users.** Not a portfolio exercise. v1 scope: Fresno County only. Web (Next.js) + mobile (Expo/React Native), one shared FastAPI backend. Budget: free tiers while in test mode; the nonprofit can commit to paid infra once production is proven.

---

## 2. Stack decisions — and why some were reversed

| Layer | Decision | History |
|---|---|---|
| Database | **DuckDB (local) / MotherDuck (cloud), free/Lite tier** | Was briefly changed to Supabase/PostGIS mid-project over geospatial-maturity concerns, then **reversed** once real investigation showed: (a) the spatial joins (`ST_Contains`/`ST_Point`/`ST_Centroid`) already work correctly in the existing dbt models, (b) the account is free-tier ("Lite") using **Pulse ducklings**, which meter per-query in CU-seconds with no idle/cooldown billing — a good fit for a low-frequency POC workload, not the wall-clock-hour cost model initially assumed. **Do not re-propose Postgres/PostGIS without new evidence** — this was a deliberate, discussed reversal, not an oversight. |
| Transforms | **dbt** (not plain Python) | Was briefly slated to be dropped for v1 under the assumption the warehouse was still a stub. Reversed once real inventory showed 7 working dbt models with passing schema tests (`schema.yml`) already exist. Keep building in dbt. |
| Geospatial | DuckDB spatial extension (`ST_Contains`, `ST_Point`, `ST_Centroid`) | Working in `dim_sensors.sql` and `dim_zip_county.sql`. Known long-term limitation: no native spatial index yet (R-tree in development) — not a binding constraint at Fresno-county scale, but worth re-evaluating if scope ever expands beyond one county. |
| Map geometry | PMTiles, generated via Tippecanoe | Unaffected by the DB decision — static file, hosted on Cloudflare R2, read directly by MapLibre. Not yet implemented. |
| Web | Next.js + MapLibre GL JS | Not yet implemented — `apps/web` doesn't exist. |
| Mobile | Expo + React Native | Not yet implemented — `apps/mobile` doesn't exist. |
| Scheduling | GitHub Actions — **known unresolved issue** | `on.schedule` is documented by GitHub as best-effort with 5-30+ min delays. This is **independent of the database decision** and was never resolved — still needs either an external trigger (`workflow_dispatch` via a free scheduler) or a loosened freshness SLA. Do not assume this is fixed. |
| PurpleAir sourcing | Two-phase: small existing public sensor set now, nonprofit-owned sensors post-POC | Free API access applies once sensors are owned. |
| Cost monitoring | Watch MotherDuck CU consumption via `MD_INFORMATION_SCHEMA.QUERY_HISTORY` once running live, **especially on the spatial join queries** (`dim_sensors`, `dim_zip_county`) — MotherDuck's own docs note complex/spatial queries may cost more on Pulse than simple aggregations. This is an open monitoring item, not yet measured against real usage. |

---

## 3. Data correction — required, not optional, and currently WRONG in the code

`warehouse/dbt/macros/pm25_correction.sql` currently implements a **placeholder formula** (`0.52 × pm2.5 − 0.085 × humidity + 5.71`), explicitly commented as "a simple, stable v1 correction," not the real EPA formula. **This needs to be replaced.**

The real, EPA-adopted formula (Barkjohn et al., 2021 — same one used on AirNow's Fire and Smoke Map):

```
PM2.5_corrected = 0.541 × PA_cf1(avg of channel A and B) − 0.0618 × RH + 0.00534 × T + 3.634
```

**This requires more than swapping the macro.** The current raw ingestion (`pipelines/ingestion/purpleair/client.py`, `raw.raw_purpleair_readings` table) only captures a single already-blended `pm2_5` field — it does **not** capture the separate channel A/B `cf_1` readings the real formula needs. To implement this correctly:
1. `client.py` must request the PurpleAir fields for channel A and B `cf_1` PM2.5 (not just the blended `pm2_5` field)
2. `raw.raw_purpleair_readings` schema (in `load_raw.py`'s `ensure_raw_tables`) needs new columns for these channel readings
3. `pm25_correction.sql` gets rewritten against the real formula, using `temperature_f` (already captured) and the new channel A/B columns
4. Never surface raw, uncorrected PurpleAir PM2.5 in any API response or UI

Status: **decided but not yet implemented.**

---

## 4. Honest current-state inventory (update this section as things change — do not let it go stale)

**Real and working:**
- `pipelines/ingestion/purpleair/`: `client.py`, `load_raw.py`, `sensors_registry.py` — dedupe-on-insert raw ingestion, sensor registry upsert
- `pipelines/ingestion/purpleair/discovery_daily.py`, `discovery_panel.py`, `pipelines/config/policy.discovery.yml`: a sensor-discovery system that finds fresh, outdoor PurpleAir sensors in a Fresno bbox and builds a daily panel of the 5 freshest sensors per ZIP. **Runs directly against MotherDuck (hardcoded `md:` DSN), not the shared `pipelines/common/db.py` connection helper** — worth reconciling.
- `pipelines/ingestion/geo/`: ZIP and county boundary loaders
- `warehouse/dbt/models/silver/dim_sensors.sql`, `dim_zip_county.sql`: working spatial joins (sensor→ZIP, ZIP→county)
- `warehouse/dbt/models/silver/silver_sensor_readings_10min.sql`: dedup + correction (formula wrong, see §3) + AQI derivation
- `warehouse/dbt/models/gold/gold_zip_now.sql`, `gold_zip_hourly.sql`, `gold_zip_daily.sql`, `gold_rankings.sql`: all four built
- `warehouse/dbt/macros/pm25_to_aqi.sql`: correct EPA AQI breakpoint conversion — no notes
- `warehouse/dbt/models/schema.yml`: real `not_null`/uniqueness tests across models

**Real but incomplete / needs verification:**
- `pm25_correction.sql`: wrong formula (§3)
- **Unclear/unverified: does `discovery_panel.py`'s output (top-5-freshest-per-ZIP) actually feed into `PURPLEAIR_SENSOR_IDS` for `load_raw_purpleair`?** No code connecting them was found. This handoff may not exist yet — confirm before assuming the discovery system drives ingestion.
- Has the full pipeline (discovery → ingestion → dbt run) actually been executed end-to-end against live data, or does this code look correct but remain unrun? Confirm before treating any of it as "proven."

**Doesn't exist yet:**
- `apps/web`, `apps/mobile`, `packages/shared`
- Any API route beyond `/health` in `apps/api`
- The real correction formula (§3)
- External trigger or SLA fix for the GitHub Actions cron reliability issue

**Known housekeeping item, deferred by choice:** `.env` is currently tracked in git (`git ls-files` confirms it). Decision made to not rotate credentials or untrack it for now — revisit before any collaborator access or public-facing launch.

---

## 5. Working conventions

- **Plan before you edit.** For anything touching more than one file, use Plan Mode: list files, functions, and order of operations before writing code.
- **Don't reintroduce Postgres/PostGIS** without a new, explicit discussion — see §2.
- **Any schema or API response shape change must update `docs/data_contract.md` in the same change.**
- **Before treating any pipeline component as "working," confirm it's actually been run against live data** — several pieces (§4) are unverified, not just unbuilt.
- Python: follow existing style in `pipelines/`. dbt: follow existing model structure in `warehouse/dbt/models/`.

---

## 6. Subagents (start with these two, add more as needed)

- `api-contract-agent` — owns `apps/api/`, keeps endpoints in sync with `docs/data_contract.md`.
- `qa-review-agent` — read-only, reviews diffs against the spec and data contract before merge.
