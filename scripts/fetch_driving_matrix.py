import csv
import json
import re
import urllib.request

SRC_CSV = "branches_with_waze_links_v3.csv"
OUT_JSON = "driving_matrix.json"
OSRM_TABLE = "https://router.project-osrm.org/table/v1/driving/"

# The driver's fixed start/end-of-day base: 55 Sokolov St, Ramat HaSharon
# (resolved from https://maps.app.goo.gl/jMvuV7oarKt5Khm17 via Waze geocoder).
DEPOT = {
    "name": "בסיס – סוקולוב 55, רמת השרון",
    "lat": 32.144198607,
    "lon": 34.8377102,
}
DEPOT["wazeUrl"] = f"https://waze.com/ul?ll={DEPOT['lat']:.6f},{DEPOT['lon']:.6f}&navigate=yes"

coord_re = re.compile(r"^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$")

rows = list(csv.reader(open(SRC_CSV, encoding="utf-8-sig")))
header, data = rows[0], rows[1:]

points = []  # (originalText, lat, lon)
for row in data:
    m = coord_re.match(row[3]) if row[3] else None
    if m:
        points.append({"originalText": row[0], "lat": float(m.group(1)), "lon": float(m.group(2))})

print(f"{len(points)} branch points with coordinates + 1 depot")

# index 0 = depot, indices 1..N = branch points (in `points` order)
all_coords = [DEPOT] + points
coord_str = ";".join(f"{p['lon']:.6f},{p['lat']:.6f}" for p in all_coords)
url = f"{OSRM_TABLE}{coord_str}?annotations=distance,duration"
req = urllib.request.Request(url, headers={"User-Agent": "distribution-lines-route-planner/1.0"})
with urllib.request.urlopen(req, timeout=90) as resp:
    result = json.loads(resp.read().decode("utf-8"))

if result.get("code") != "Ok":
    raise SystemExit(f"OSRM table request failed: {result}")

out = {
    "depot": DEPOT,
    "originalTexts": [p["originalText"] for p in points],
    "distances": result["distances"],  # meters, [i][j]; index 0 = depot, 1..N = originalTexts order
    "durations": result["durations"],  # seconds, [i][j]
}

with open(OUT_JSON, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False)

print(f"wrote {OUT_JSON}: {len(all_coords)}x{len(all_coords)} driving distance/duration matrix (incl. depot)")
