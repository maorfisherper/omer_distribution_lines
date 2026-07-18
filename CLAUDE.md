# Branch to Waze location project

This folder maps a list of Israeli supermarket / store branches (a client list, Hebrew
names, mostly southern and central Israel) to a Waze location link per branch. The branches
distribute dog products — the driver site (`docs/`) has light dog-themed branding (paw icon,
"PAW-01" brand mark, paw-print background texture) reflecting that; keep it tasteful and
functional, not cutesy at the expense of legibility for a driver using it in a moving vehicle.

## Files

- `branches_addresses_validated_without adresse.numbers` — the ORIGINAL source (do not overwrite).
  Two columns: `Original text` (raw branch name) and `Corrected text` (cleaned name, chain + city + landmark).
  This stays `.numbers` since it's the pre-existing source file — do not convert it.
- `branches_with_waze_links_v3.xlsx` — the deliverable. Columns:
  `Original text | Corrected text | Waze location | Coordinates | closest_arial_distance_index | closest_arial_distance_meters`.
  Links are clickable.
- `branches_with_waze_links_v3_REVIEW.xlsx` — same data plus a `Note` column saying which place
  each pin matched and any caveat. Best file for reviewing / verifying.
- `branches_with_waze_links_v3.csv` — plain-text version.
- `branches_with_waze_links_v3_days.xlsx` — the same 77 geolocated branches split into day
  routes of 7-9 stops each, stop order optimized per day. See "Day-route clustering" below.
  Two sheets: `Route` (Day, Stop #, branch info, leg distance from the previous stop) and
  `Summary` (per-day stop count / total distance, plus the day-count comparison used to pick
  the number of days).

- `docs/` — the GitHub Pages driver site (static HTML/CSS/JS, no build step). `index.html` +
  `styles.css` + `app.js` are hand-written; `data.js` is generated (see `scripts/build_site_data.py`
  below) and must be regenerated whenever the day routes or branch list change. Shows a per-day
  Leaflet/OpenStreetMap map (numbered markers + real driving route line), real driving
  distance/time per leg and per day, and a "whole day in Google Maps" link.
- `driving_matrix.json` — cached NxN real driving distance/duration matrix (all 77 geolocated
  branches, from OSRM's `table` service) used to cluster days and order stops. See "Day-route
  clustering" below.
- `driving_routes.json` — cached real driving distances/durations/route geometry per day from OSRM
  (see "Driving distances" below). Committed so the site doesn't depend on a live routing call.

Deliverables are Excel (`.xlsx`) only, not `.numbers` — see Conventions below.

Row count in the deliverable is 79 (the 81 source branches, minus 3 dropped data-error rows,
plus 1 because one branch was split into two clients). One row is still `TODO` on purpose
(`מחסני השוק – סניף חדש`, no location yet) and one is blank (`קרפור – לב אשקלון`, not reviewed).

## How a branch becomes a Waze link

### 1. Find the place in Waze (the geocoder)

Waze's own search backend, Israel environment. Fuzzy, returns up to ~10 ranked results:

```
GET https://www.waze.com/il-SearchServer/mozi?q=<QUERY>&lang=heb&origin=livemap&lat=31.5&lon=34.7
Headers: User-Agent: <a normal browser UA>   Referer: https://www.waze.com/live-map
```

Each result has `name`, `businessName`, `city`, `street`, and `location: {lat, lon}`.
Use `il-SearchServer` for Israel (not `row-SearchServer` or `SearchServer`). Match candidates by
chain name + city + street/landmark, and cluster by coordinates (store, its parking, and its
supplier entrance show up as separate pins ~50-150 m apart but are the same place).

### 2. Build the link

```
https://waze.com/ul?ll=<lat>,<lon>&navigate=yes
```

Coordinates are written to 6 decimals (~0.1 m). The `Coordinates` column holds the same `lat, lon`.

### Linking rule

- Exactly one matching location, or several name variants at one spot: add the link.
- Several genuinely different stores and the name does not say which: leave blank (do not guess).
- Not in Waze: leave blank, or use a coordinate / address the user provides.

## Resolving a Google Maps link the user shares

- `maps.app.goo.gl/...` links resolve cleanly. Fetch with a mobile (iPhone) User-Agent and follow
  redirects; the `Location` header is a `/maps/place/<name>/@lat,lon,z/data=...!3d<lat>!4d<lon>` URL.
  Take the `!3d` / `!4d` pair (the exact place), not the `@` viewport center.
- `share.google/...` links redirect to a `google.com/search?kgmid=/g/...&q=<name>` knowledge panel.
  The coordinates are loaded by JavaScript, so curl cannot read them and automated Google access
  gets CAPTCHA-walled. Do not solve CAPTCHAs. Instead resolve by the business name via Waze, or ask
  the user to re-share as a `maps.app.goo.gl` link ("Share -> Copy link" in Google Maps) or an address.

## Day-route clustering

Splits the geolocated branches into day routes of 7-9 stops, minimizing total **real driving
distance** (OSRM road-network distance, not straight-line):

1. `scripts/fetch_driving_matrix.py` gets the full 77x77 driving distance/duration matrix from
   OSRM's `table` service in a single request, cached in `driving_matrix.json`.
2. `scripts/build_day_routes.py` clusters using that matrix (capacitated k-medoids, since driving
   distance isn't Euclidean so there's no coordinate centroid to average — a medoid is the cluster
   member with the lowest total distance to the rest of the cluster):
   - Try every feasible number of days `k` (i.e. `ceil(n/9) <= k <= floor(n/7)`).
   - For each `k`: k-medoids++ seeding + Lloyd-style reassignment, greedy rebalancing to enforce
     7-9 per cluster, then pairwise-swap local search between clusters (all driven by the real
     distance matrix, not planar coordinates).
   - Within each day, brute-force the exact optimal visiting order (open-path, no return leg) —
     feasible since a day never has more than 9 stops (≤ 9! permutations), using real driving
     distances between stops.
   - Pick the `k` with the lowest total real driving distance summed across all days.

Branches without coordinates are excluded from clustering and listed separately as "Unscheduled".
Re-run both scripts whenever the branch list or coordinates change — it's a fresh optimization, not
an incremental update.

## Driving distances (per-day route geometry)

`scripts/fetch_driving_distances.py` calls the free OSRM public demo server
(`router.project-osrm.org`, driving profile, no API key) once per day route, in the stop order
already fixed by day-route clustering. One request per day returns the whole day's real distance,
duration, per-leg distance/duration, and the full route geometry (for the map polyline). Results
are cached in `driving_routes.json` — the site never calls OSRM live (avoids depending on / abusing
the free demo server from every driver's phone). Be polite: keep the ~1s delay between requests, and
re-run this only when the day routes actually change, not on every site rebuild.

(This is a separate call from `fetch_driving_matrix.py`: the matrix drives the clustering/ordering
*decision*, this fetches the actual route *geometry* for the map, for the final chosen order. Their
leg distances should closely agree since both come from OSRM, but re-run both together after any
re-clustering so they stay consistent.)

The site's "day total" and per-leg figures show driving distance/time when available, falling back
to straight-line distance if `driving_routes.json` is missing or a day's fetch failed.

## Regenerating the spreadsheet

Python with `openpyxl` (xlsx with real hyperlinks):

```
python3 -m venv venv && source venv/bin/activate && pip install openpyxl
```

The per-branch decisions are the real work product and are not fully automatable; keep them in a
data table and regenerate the files from it.

Scripts (run from the project root, after activating `venv`):

- `scripts/build_deliverable_xlsx.py` — builds `branches_with_waze_links_v3.xlsx` from the `_v3.csv`.
- `scripts/fetch_driving_matrix.py` — builds/refreshes `driving_matrix.json` from `_v3.csv`
  (needs internet access). Run this first if branch coordinates changed.
- `scripts/build_day_routes.py` — builds `branches_with_waze_links_v3_days.xlsx` (day clustering,
  see "Day-route clustering" above) from `_v3.csv` + `driving_matrix.json`.
- `scripts/fetch_driving_distances.py` — builds/refreshes `driving_routes.json` from
  `branches_with_waze_links_v3_days.xlsx` (see "Driving distances" above). Needs internet access.
- `scripts/build_site_data.py` — regenerates `docs/data.js` for the GitHub Pages driver site from
  the `_v3.xlsx`, `_v3_days.xlsx`, and `driving_routes.json` files. Run this last.

Full regeneration order after a data change: `fetch_driving_matrix.py` -> `build_day_routes.py` ->
`fetch_driving_distances.py` -> `build_site_data.py`.

## Conventions

- Deliverables are Excel (`.xlsx`) only — do not generate or update `.numbers` files, even though
  the original source happens to be one. Read the source `.numbers` with `numbers-parser` if needed,
  but write output with `openpyxl`.
- Never overwrite the original source file. Write new versioned files (`_v2`, `_v3`, ...).
- Resolve relative dates and any times in Israel time (Asia/Jerusalem).
