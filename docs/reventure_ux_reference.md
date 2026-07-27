# Reventure UX Pattern Reference (for HFA web app)

Source: user-provided screenshots of reventure.app/map (2026-07-25), plus prior research on Reventure's product model. This documents *patterns*, not pixels — HFA should follow the interaction logic, not clone the visual design.

**Known gap:** this was built from static screenshots, not live interaction — hover states, transition behavior, and tab-switching mechanics weren't observable. Flagged as a follow-up once browser automation is available (see bottom).

---

## 1. Top navigation / granularity switcher

- A search bar (search by County, City, or ZIP) sits at the top, paired with radio-button granularity toggle: **National / State / Metro / County / Zip**
- Switching granularity re-renders the same map at a different polygon resolution — same data, different zoom-equivalent unit, not a separate page
- **HFA equivalent:** same pattern, but HFA's stated v1 scope is ZIP-only within Fresno County — so this control should exist in the UI but be visually present-and-disabled (or hidden) beyond "Zip," not built out for County/Metro/State yet. Worth building the *component* generically now so state/national expansion later doesn't require a rewrite, even though only "Zip" is functional in v1.

## 2. Left sidebar — data point selector

- Collapsible categories: "Popular Data," "Home Price & Affordability," "Market Trends," "Demographic," "Investor Metrics," "Reventure Scores" (tagged **"New"**)
- Each row: radio button (selects which metric colors the map) + metric name + info icon (`i`) + a small crown icon on premium-gated metrics
- Selecting a radio button changes what the choropleth/markers are colored by — this is the core interaction driving the whole map
- Each metric's explainer (visible in the detail panel, not confirmed as sidebar-hover) carries **explicit source attribution** per field — some cite Zillow, some cite the US Census Bureau directly, some are labeled as Reventure's own calculation blending multiple sources
- **HFA equivalent:** v1 only has one real metric (AQI/PM2.5), so this selector isn't needed yet — but it's the natural home for the Census demographics filter, and every metric HFA adds should carry the same explicit source-attribution pattern (already a stated principle from the data contract work).

### 2a. Verified: exact Census/ACS field list (live-checked, not inferred)

Confirmed directly from the site's Demographic category — this is the real, exact list, useful as a direct design target for HFA's own Census layer rather than a vague gesture at "income, education, age":

Population, Population Growth, Median Household Income, Income Growth, Population Density (/sq mi), Weather (Avg Temperature), Remote Work %, College Degree Rate, Homeownership Rate, Homeowners 25-44 %, Homeowners 75+ %, Mortgaged Home %, Median Age, Poverty Rate, Family Households %, Single Households %, Housing Units, Housing Unit Growth Rate.

**HFA equivalent:** this is a strong starting shortlist for the ZCTA-level ACS pipeline named in CLAUDE.md's stack table — particularly Median Age, Poverty Rate, and Population Density are plausible candidates for cross-referencing against AQI (e.g. "does poor air quality correlate with poverty rate by ZIP" is a genuinely compelling public-interest visualization, directly on-mission for an environmental-justice-focused nonprofit).

## 2b. Filter panel — separate from the sidebar selector

- A distinct "Filter" control (top nav) opens numeric range sliders (min/max, plus typed number inputs) per metric, independent from which metric is currently coloring the map
- One-click presets exist: "Cheapest," "Most Expensive," "Affordable," "High Income," "Most Overvalued," "Least Overvalued," "High Population"
- **HFA equivalent:** directly adoptable pattern — an AQI range filter plus presets like "Cleanest Air," "Most Polluted," "Most Improved," filtered against `gold_zip_now`/`gold_rankings`. Worth building as its own component, separate from the "what colors the map" selector, matching Reventure's separation of concerns.

## 2c. "Reventure Scores" — confirmed as a recent, separately-promoted add-on, not core

- The tab is explicitly tagged "New" in the live UI, containing "Home Price Forecast (1-Year)" and "Long-Term Growth Score" (also tagged "New"), both premium-gated
- **HFA equivalent:** useful precedent — even Reventure's own proprietary score shipped *after* the core product, as a distinct, separately-flagged feature. Reinforces that HFA's planned AQI "score" (already v2-scoped) doesn't need to exist for v1 to feel complete; it's correctly sequenced as a later, separately-shipped addition, same as Reventure's own history suggests.



## 3. Map coloring + legend

- Choropleth-style fill (not just markers) colored by the selected metric, with a gradient legend bottom-right showing the value range
- **HFA equivalent:** this is exactly the ZIP-polygon-fill capability that depends on the not-yet-built PMTiles pipeline. Markers (current state) are the correct interim step; filled choropleth is the real target once geometry exists — worth naming this explicitly as "Phase 2 of the map" in the spec rather than a vague someday.

## 4. Click interaction — two-tier detail

- **Tier 1 (light):** clicking a ZIP shows a small dark tooltip — value + "Click here to see historical data"
- **Tier 2 (full):** clicking through opens a full detail panel: breadcrumb pills (County/Metro/State), big ZIP number as the header, source attribution + data date + next-update date, a tabbed sub-view (e.g. "Home Price Forecast / Investor Score / Long-Term Growth Score"), a time-series chart with a dropdown to pick which series to plot, and a "Watch video to learn about this data point" explainer link per metric
- **HFA equivalent:** Tier 1 = the marker popup already built (zip, town, aqi, category, updated_ts). Tier 2 = the natural home for the hourly/daily trend charts (explicitly deferred from the current build pass) — this is good evidence they belong as a full detail panel, not squeezed into the popup.

## 5. Monetization surfaced in the UI itself

- "Unlock forecast • Upgrade" gate directly inside the free detail view, plus a persistent "Analyze a listing" CTA banner
- **HFA equivalent:** given the earlier decision that HFA's core AQI data stays free (not paywalled, unlike Reventure's forecast), this pattern should **not** be copied for core data — but the visual mechanism (a soft CTA banner) could resurface later for something like "Report a sensor issue" or a donation prompt, without gating any actual air quality information behind it.

## 6. Supporting controls

- Tooltip on/off toggle, Table View toggle (same data, tabular instead of map), a date picker showing current period + next scheduled update
- **HFA equivalent:** Table View is a cheap, high-value addition — the ranking panel already being built is functionally this. The "next update" date pattern is worth adopting directly, since it turns the freshness/cron work from earlier into a visible trust signal for users, not just a backend concern.

---

## Live verification status

Done this session, via Claude in Chrome, directly against reventure.app/map: granularity switcher, sidebar category expansion (all categories, including the full exact Demographic/Census field list above), Tier-1 tooltip → Tier-2 detail panel flow, internal tab switching (Home Price Forecast / Investor Metrics / Reventure Scores), and the Filter panel's range-slider + preset pattern.

**Not yet confirmed:** exact hover-vs-click trigger for the sidebar's `i` info icons, and mobile/responsive behavior. Minor, worth a fast follow-up but not blocking anything in the current build.
