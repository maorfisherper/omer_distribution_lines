# Branch to Waze location project

This folder maps a list of Israeli supermarket / store branches (a client list, Hebrew
names, mostly southern and central Israel) to a Waze location link per branch.

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

Splits the geolocated branches into day routes of 7-9 stops, minimizing total driving distance
(great-circle/haversine, not real road distance):

1. Try every feasible number of days `k` (i.e. `ceil(n/9) <= k <= floor(n/7)`).
2. For each `k`: capacitated k-means (planar-projected lat/lon) + greedy rebalancing to enforce
   7-9 per cluster, then pairwise-swap local search between clusters.
3. Within each day, brute-force the exact optimal visiting order (open-path, no return leg) —
   feasible since a day never has more than 9 stops (≤ 9! permutations).
4. Pick the `k` with the lowest total distance summed across all days.

Branches without coordinates are excluded from clustering and listed separately as "Unscheduled".
Re-run this whenever the branch list or coordinates change — it's a fresh optimization, not an
incremental update.

## Regenerating the spreadsheet

Python with `openpyxl` (xlsx with real hyperlinks):

```
python3 -m venv venv && source venv/bin/activate && pip install openpyxl
```

The per-branch decisions are the real work product and are not fully automatable; keep them in a
data table and regenerate the files from it.

Scripts (run from the project root, after activating `venv`):

- `scripts/build_deliverable_xlsx.py` — builds `branches_with_waze_links_v3.xlsx` from the `_v3.csv`.
- `scripts/build_day_routes.py` — builds `branches_with_waze_links_v3_days.xlsx` (day clustering,
  see "Day-route clustering" above) from the `_v3.csv`.
- `scripts/build_site_data.py` — regenerates `docs/data.js` for the GitHub Pages driver site from
  the `_v3.xlsx` and `_v3_days.xlsx` files. Run this after either of the above changes.

## Conventions

- Deliverables are Excel (`.xlsx`) only — do not generate or update `.numbers` files, even though
  the original source happens to be one. Read the source `.numbers` with `numbers-parser` if needed,
  but write output with `openpyxl`.
- Never overwrite the original source file. Write new versioned files (`_v2`, `_v3`, ...).
- Resolve relative dates and any times in Israel time (Asia/Jerusalem).
