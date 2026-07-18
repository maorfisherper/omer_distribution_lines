import json
import re
import time
import urllib.request

import openpyxl

DAYS_XLSX = "branches_with_waze_links_v3_days.xlsx"
OUT_JSON = "driving_routes.json"
OSRM_BASE = "https://router.project-osrm.org/route/v1/driving/"

coord_re = re.compile(r"^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$")


def parse_coords(s):
    m = coord_re.match(s) if s else None
    return (float(m.group(1)), float(m.group(2))) if m else None  # (lat, lon)


wb = openpyxl.load_workbook(DAYS_XLSX, data_only=True)
route_ws = wb["Route"]

days = {}
for row in route_ws.iter_rows(min_row=2, values_only=True):
    day, stop, orig, corrected, waze, coords, leg = row
    if day == "Unscheduled":
        continue
    latlon = parse_coords(coords)
    if latlon is None:
        continue
    days.setdefault(int(day), []).append({"stop": int(stop), "originalText": orig, "lat": latlon[0], "lon": latlon[1]})

result = {}
for day_num in sorted(days):
    stops = sorted(days[day_num], key=lambda s: s["stop"])
    coord_str = ";".join(f"{s['lon']:.6f},{s['lat']:.6f}" for s in stops)
    url = f"{OSRM_BASE}{coord_str}?overview=full&geometries=geojson&steps=false"

    attempt = 0
    data = None
    while attempt < 3:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "distribution-lines-route-planner/1.0"})
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            if data.get("code") == "Ok":
                break
        except Exception as e:
            print(f"day {day_num} attempt {attempt} error: {e}")
        attempt += 1
        time.sleep(2)

    if data is None or data.get("code") != "Ok":
        print(f"day {day_num}: FAILED to fetch driving route, skipping")
        continue

    route = data["routes"][0]
    legs = route["legs"]
    geometry = route["geometry"]["coordinates"]  # [ [lon,lat], ... ]

    result[day_num] = {
        "totalDistanceM": round(route["distance"]),
        "totalDurationS": round(route["duration"]),
        "legs": [
            {"distanceM": round(leg["distance"]), "durationS": round(leg["duration"])}
            for leg in legs
        ],
        "geometry": [[round(lat, 6), round(lon, 6)] for lon, lat in geometry],  # -> [lat, lon] for Leaflet
    }
    print(f"day {day_num}: {route['distance']/1000:.1f} km driving, {route['duration']/60:.0f} min, "
          f"{len(geometry)} geometry points")
    time.sleep(1.2)  # be polite to the free demo server

with open(OUT_JSON, "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, indent=2)

print(f"wrote {OUT_JSON}: {len(result)} / {len(days)} days")
