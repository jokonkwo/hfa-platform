# Healthy Fresno Air (HFA)

Healthy Fresno Air (HFA) is a **map-first air quality intelligence platform** that allows users to explore air quality by geography (State → County → ZIP) using near–real-time sensor data.  
The system is designed for **fast map rendering**, **reliable data freshness**, and **clear separation of concerns** between ingestion, transformation, serving, and UI.

This repository contains the full end-to-end system: data pipelines, analytics warehouse, backend API, and frontend application.

---

## Architecture Overview

HFA follows a simple but production-grade flow:

**Data Sources → Warehouse → API → Web UI**

### Data Sources
- **PurpleAir**: live air quality sensor readings (micro-batched)
- **ZIP boundaries**: GeoJSON / shapefiles
- **Demographics**: static CSV or API-based sources

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
- Does *not* perform heavy transformations

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

```text
hfa/
  apps/
    api/            # FastAPI backend
    web/            # Next.js + MapLibre frontend

  warehouse/
    dbt/            # dbt models (RAW / SILVER / GOLD)

  pipelines/
    ingestion/      # Python ingestion jobs
    scripts/        # one-off operational scripts

  configs/          # environment and logging configs
  docs/             # architecture, ADRs, runbooks

  .github/
    workflows/      # CI and scheduled pipelines

  pyproject.toml
  README.md
