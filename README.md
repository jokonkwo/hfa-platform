# Healthy Fresno Air (HFA)

Healthy Fresno Air (HFA) is a **map-first air quality intelligence platform** that allows users to explore air quality by geography (State → County → ZIP) using near–real-time sensor data.

The system is designed for **fast map rendering**, **reliable data freshness**, and **clear separation of concerns** between ingestion, transformation, serving, and UI.

This repository contains the full end-to-end system: data pipelines, analytics warehouse, backend API, and frontend application.

---

## Architecture Overview

HFA follows a simple but production-grade flow:

**Data Sources → Warehouse → API → Web UI**

### Data Sources
- **PurpleAir** — live air quality sensor readings (micro-batched)
- **ZIP boundaries** — GeoJSON / shapefiles
- **Demographics** — static CSV or API-based sources

### Warehouse (System of Record)
- **DuckDB** for local development
- **MotherDuck** for production analytics
- Data modeled using a **RAW → SILVER → GOLD** medallion pattern

### Pipelines
- **Python** ingestion jobs pull external data and stage RAW tables
- **dbt (DuckDB adapter)** transforms RAW → SILVER → GOLD
- **GitHub Actions** schedules ingestion and transformations (hourly / nightly)

### Backend API
- **FastAPI** provides a read-only API over curated (Gold) tables
- Returns **map-friendly payloads** and time series
- Applies caching, validation, and pagination
- Does **not** perform heavy transformations

### Frontend
- **Next.js** + **MapLibre**
- Map-first UI with geometry and metrics rendered as separate layers
- The frontend never computes AQI or analytics metrics

---

## Core Design Principles

### Single Source of Truth
All data served to users must be derivable from tables in the warehouse.

### Clear Boundaries
- **Pipelines** own ingestion and transformations
- **Warehouse** owns analytics state
- **API** owns validation, caching, and response shaping
- **UI** owns rendering and interaction only

### Two-Speed Data Model
- **“Now” data** refreshed frequently (1–10 minutes) for perceived real-time UX
- **Historical data** aggregated hourly/daily for trends and analysis

### Map Performance
- Geometry is precomputed and simplified at multiple zoom levels
- Metrics and geometry are fetched separately and joined client-side
- Avoids sending full GeoJSON payloads on every request

---

## Repository Structure

hfa/  
├── apps/  
│   ├── api/            # FastAPI backend  
│   └── web/            # Next.js + MapLibre frontend  
│  
├── warehouse/  
│   └── dbt/            # dbt models (RAW / SILVER / GOLD)  
│  
├── pipelines/  
│   ├── ingestion/      # Python ingestion jobs  
│   └── scripts/        # One-off operational scripts  
│  
├── configs/            # Environment and logging configs  
├── docs/               # Architecture, ADRs, runbooks  
├── .github/  
│   └── workflows/      # CI and scheduled pipelines  
│  
├── pyproject.toml  
└── README.md  

Each directory maps to a **runtime or ownership boundary**, making the system easy to evolve without refactoring the repo layout.

---

## Local Development (High Level)

Detailed setup instructions live in component-level READMEs.

Typical local flow:
1. Run ingestion jobs against local DuckDB
2. Execute dbt models to build Silver/Gold tables
3. Start the FastAPI service
4. Run the Next.js web app

---

## Operational Notes

- All scheduled pipelines run via **GitHub Actions**
- Pipeline runs write metadata to an `ops.pipeline_runs` table
- Slack notifications are sent on:
  - pipeline failures
  - data freshness breaches
- All served datasets include an `updated_at` timestamp

---

## Status

This repository represents the **v1 production-ready architecture**.

The system is intentionally designed to evolve:
- DuckLake and external object storage can be added as data volume grows
- Airflow or Prefect can replace GitHub Actions if orchestration complexity increases
- Vector tiles can replace simplified geometry layers at higher traffic

---

## License

MIT
