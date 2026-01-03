# HFA Architecture Overview

Healthy Fresno Air (HFA) is a **map-first air quality intelligence platform**. The map is the primary interface: users explore State → County → ZIP, view “now” air quality, and drill into short-term trends and historical summaries.

This document describes the **v1 production-ready architecture**: data ingestion, transformation, serving, UI, and operational guarantees.

---

## Goals

1. **Map-first performance**
   - Fast layer rendering
   - Low payload sizes
   - Viewport/county scoped responses
2. **Correctness & reproducibility**
   - Clear lineage (RAW → SILVER → GOLD)
   - Idempotent ingestion
   - Easy backfills
3. **Low ops overhead**
   - Minimal infrastructure footprint
   - Simple, observable scheduling
4. **Single system of record**
   - One canonical place where data lives
5. **Interview-grade engineering**
   - Clean boundaries
   - Strong contracts
   - Observability and data quality

---

## System Design (End-to-End)

### High-level flow
**Sources → Pipelines → Warehouse → API → Web UI**

### Components
- **Sources**
  - PurpleAir sensor readings (micro-batched)
  - ZIP geometry boundaries (GeoJSON/Shapefiles)
  - Demographics (CSV/API)
- **Pipelines**
  - Python ingestion jobs stage RAW tables
  - dbt transforms RAW → SILVER → GOLD
  - GitHub Actions schedules jobs and sends notifications
- **Warehouse**
  - DuckDB locally for development
  - MotherDuck for production
- **Backend API**
  - FastAPI serving read-only endpoints over Gold tables
  - caching on hot endpoints
- **Frontend**
  - Next.js + MapLibre
  - geometry and metrics fetched separately and joined by ZIP key client-side

---

## Boundaries (Non-negotiable)

### Frontend
- Renders and manages UI state only
- **Never computes metrics**
- Joins geometry + metrics by ZIP key (lightweight join)

### Backend API
- Read-only access to curated tables
- **No heavy transformations at request-time**
- Responsible for:
  - caching
  - pagination
  - validation (schemas)
  - response shaping for map UX

### Pipelines
- Own ingestion and transformations
- Produce canonical tables and precomputed layers
- Handle reruns/backfills and data quality checks

### Warehouse
- The single source of truth
- Anything served must be derived from warehouse tables

---

## Data Model: RAW → SILVER → GOLD

### RAW (immutable truth)
- `raw_purpleair_readings`
- `raw_zip_boundaries`
- `raw_demographics`

Rules:
- append-only
- minimal parsing
- provenance columns: `ingested_at`, `source`, `schema_version`

### SILVER (cleaned & standardized)
- `silver_sensor_readings_10min`
- `silver_zip_lookup`
- `silver_sensor_zip_join` (precomputed spatial mapping)

Rules:
- typing and normalization
- dedupe and correction logic
- stable join keys (sensor_id, zip)

### GOLD (product-ready)
- `gold_zip_now`
- `gold_zip_hourly`
- `gold_zip_daily`
- `gold_rankings`
- `gold_alerts`

Rules:
- shaped for API read patterns
- includes `updated_at`
- minimizes expensive runtime queries

---

## Map Performance Strategy

### Problem
ZIP geometries are large. Serving full GeoJSON repeatedly is slow and expensive.

### v1 approach (“tile-like” without tile infrastructure)
Precompute simplified ZIP geometries at multiple zoom levels:

- `zip_geom_z7` (very simplified)
- `zip_geom_z9` (medium)
- `zip_geom_z11` (detailed)

API serves:
- geometry-only layer by county + zoom
- metrics-only layer by county
Frontend joins by ZIP.

### v2 approach (true vector tiles)
At higher traffic, move to:
- MBTiles generation or vector tile service
- tile requests by viewport/zoom

---

## Backend API Contract (v1)

Minimum endpoints:
- `GET /meta/counties`
- `GET /meta/zips?county=Fresno`
- `GET /layers/zips?county=Fresno&zoom=9` (geometry only)
- `GET /metrics/zips/now?county=Fresno`
- `GET /metrics/zip/{zip}/timeseries?granularity=hour&start=...&end=...`
- `GET /rankings?window=7d`
- `GET /health` (freshness + last successful pipeline run)

Caching guidance:
- cache geometry layers by county+zoom
- cache “now” metrics briefly (1–5 min)

---

## Orchestration & Operations

### Scheduling
GitHub Actions (cron):
- **hourly**: ingest PurpleAir → dbt run for “now/hourly” Gold tables
- **nightly**: full dbt run + rankings + compaction + quality report

### Observability
- write every run to `ops.pipeline_runs`
- log structured JSON to stdout
- alert via Slack on failure and freshness breaches

### Data quality
dbt tests:
- uniqueness of (zip, timestamp) where applicable
- not_null for key columns
- accepted_values for AQI categories
- relationship tests for join keys

---

## Deployment (v1 targets)

- **API**: Fly.io / Render / container-based deployment
- **Web**: Vercel (recommended for Next.js)
- **Warehouse**: MotherDuck

---

## Future Extensions

- DuckLake + BYO bucket for large raw history
- Redis for shared caching (multi-instance API)
- Vector tiles for higher traffic
- Auth + saved views (optional; Supabase sidecar if needed)
