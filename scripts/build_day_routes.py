import csv
import json
import math
import random
import re
from itertools import permutations

import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment

SRC_CSV = "branches_with_waze_links_v3.csv"
MATRIX_JSON = "driving_matrix.json"
OUT_XLSX = "branches_with_waze_links_v3_days.xlsx"
MIN_PER_DAY = 7
MAX_PER_DAY = 9

coord_re = re.compile(r"^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$")

rows = list(csv.reader(open(SRC_CSV, encoding="utf-8-sig")))
header, data = rows[0], rows[1:]

valid = []
invalid = []
for row in data:
    m = coord_re.match(row[3]) if row[3] else None
    if m:
        valid.append({"row": row, "lat": float(m.group(1)), "lon": float(m.group(2))})
    else:
        invalid.append(row)

n = len(valid)
print("valid points:", n, "invalid/no-coord:", len(invalid))

with open(MATRIX_JSON, encoding="utf-8") as f:
    matrix = json.load(f)

assert matrix["originalTexts"] == [v["row"][0] for v in valid], (
    "driving_matrix.json point order doesn't match branches_with_waze_links_v3.csv — "
    "re-run scripts/fetch_driving_matrix.py"
)

D = matrix["distances"]  # real driving distance in meters, D[i][j]


def recompute_medoid(members):
    if len(members) == 1:
        return members[0]
    return min(members, key=lambda m: sum(D[m][i] for i in members))


# ---- feasible day counts given 7-9 points/day ----
feasible_k = [k for k in range(math.ceil(n / MAX_PER_DAY), math.floor(n / MIN_PER_DAY) + 1)]
print("feasible day counts:", feasible_k)


def seed_medoids(k, rng):
    medoids = [rng.randrange(n)]
    while len(medoids) < k:
        d2 = [min(D[m][i] for m in medoids) ** 2 for i in range(n)]
        total = sum(d2)
        r = rng.uniform(0, total) if total > 0 else 0
        acc, chosen = 0.0, None
        for i, d in enumerate(d2):
            acc += d
            if acc >= r:
                chosen = i
                break
        medoids.append(chosen if chosen is not None else rng.randrange(n))
    return medoids


def capacitated_kmedoids(k, seed):
    rng = random.Random(seed)
    medoids = seed_medoids(k, rng)

    clusters = {c: [] for c in range(k)}
    for _ in range(30):
        changed = False
        assign = [min(range(k), key=lambda c: D[medoids[c]][i]) for i in range(n)]
        clusters = {c: [i for i in range(n) if assign[i] == c] for c in range(k)}
        new_medoids = [recompute_medoid(clusters[c]) if clusters[c] else medoids[c] for c in range(k)]
        if new_medoids != medoids:
            changed = True
        medoids = new_medoids
        if not changed:
            break

    return clusters


def enforce_capacity(clusters, min_size=MIN_PER_DAY, max_size=MAX_PER_DAY, max_iter=2000):
    clusters = {c: list(v) for c, v in clusters.items()}
    medoids = {c: (recompute_medoid(v) if v else None) for c, v in clusters.items()}

    for _ in range(max_iter):
        over = [c for c in clusters if len(clusters[c]) > max_size]
        if over:
            c = over[0]
            m = medoids[c]
            worst = max(clusters[c], key=lambda i: D[m][i])
            candidates = [cj for cj in clusters if cj != c and len(clusters[cj]) < max_size]
            if not candidates:
                break

            def key_fn(cj):
                mj = medoids[cj]
                return 0.0 if mj is None else D[mj][worst]

            target = min(candidates, key=key_fn)
            clusters[c].remove(worst)
            clusters[target].append(worst)
            medoids[c] = recompute_medoid(clusters[c]) if clusters[c] else None
            medoids[target] = recompute_medoid(clusters[target])
            continue

        under = [c for c in clusters if len(clusters[c]) < min_size]
        if under:
            c = under[0]
            m = medoids[c]
            donors = [(cj, i) for cj in clusters if cj != c and len(clusters[cj]) > min_size for i in clusters[cj]]
            if not donors:
                break
            if m is None:
                cj, i = donors[0]
            else:
                cj, i = min(donors, key=lambda t: D[m][t[1]])
            clusters[cj].remove(i)
            clusters[c].append(i)
            medoids[cj] = recompute_medoid(clusters[cj]) if clusters[cj] else None
            medoids[c] = recompute_medoid(clusters[c])
            continue
        break

    return clusters


def swap_refine(clusters, passes=10):
    clusters = {c: list(v) for c, v in clusters.items()}
    ids = list(clusters.keys())
    for _ in range(passes):
        improved = False
        medoids = {c: recompute_medoid(clusters[c]) for c in ids}
        for a_idx in range(len(ids)):
            for b_idx in range(a_idx + 1, len(ids)):
                ca, cb = ids[a_idx], ids[b_idx]
                for i in list(clusters[ca]):
                    for j in list(clusters[cb]):
                        cur = D[medoids[ca]][i] + D[medoids[cb]][j]
                        new = D[medoids[ca]][j] + D[medoids[cb]][i]
                        if new < cur - 1e-6:
                            clusters[ca].remove(i)
                            clusters[ca].append(j)
                            clusters[cb].remove(j)
                            clusters[cb].append(i)
                            medoids[ca] = recompute_medoid(clusters[ca])
                            medoids[cb] = recompute_medoid(clusters[cb])
                            improved = True
                            break
                    else:
                        continue
                    break
        if not improved:
            break
    return clusters


def optimal_path_order(indices):
    if len(indices) <= 1:
        return list(indices), 0.0
    best_order, best_len = None, None
    for perm in permutations(indices):
        length = sum(D[perm[i]][perm[i + 1]] for i in range(len(perm) - 1))
        if best_len is None or length < best_len:
            best_len, best_order = length, list(perm)
    return best_order, best_len


def total_route_length(clusters):
    total = 0.0
    orders = {}
    for c, members in clusters.items():
        order, length = optimal_path_order(members)
        orders[c] = (order, length)
        total += length
    return total, orders


RESTARTS = 12
results_by_k = {}
for k in feasible_k:
    best_clusters, best_total, best_orders = None, None, None
    for seed in range(RESTARTS):
        clusters = capacitated_kmedoids(k, seed)
        clusters = enforce_capacity(clusters)
        if not all(MIN_PER_DAY <= len(v) <= MAX_PER_DAY for v in clusters.values()):
            continue
        clusters = swap_refine(clusters)
        if not all(MIN_PER_DAY <= len(v) <= MAX_PER_DAY for v in clusters.values()):
            continue
        total, orders = total_route_length(clusters)
        if best_total is None or total < best_total:
            best_total, best_clusters, best_orders = total, clusters, orders
    results_by_k[k] = (best_total, best_clusters, best_orders)
    sizes = sorted(len(v) for v in best_clusters.values()) if best_clusters else None
    print(f"k={k}: best total driving distance = {best_total:.0f} m ({best_total/1000:.1f} km), sizes={sizes}")

best_k = min(results_by_k, key=lambda k: results_by_k[k][0])
best_total, best_clusters, best_orders = results_by_k[best_k]
print(f"\nchosen: {best_k} days, total {best_total/1000:.1f} km (real driving distance)")

day_results = []


def day_centroid_lat(members):
    return sum(valid[i]["lat"] for i in members) / len(members)


ordered_cluster_ids = sorted(best_clusters.keys(), key=lambda c: -day_centroid_lat(best_clusters[c]))
for day_num, c in enumerate(ordered_cluster_ids, start=1):
    order, length = best_orders[c]
    day_results.append((day_num, order, length))
    print(f"day {day_num}: {len(order)} stops, {length:.0f} m driving")

# ================= build output workbook =================
wb = openpyxl.Workbook()
ws = wb.active
ws.title = "Route"
ws.sheet_view.rightToLeft = True
ws.freeze_panes = "A2"

out_header = ["Day", "Stop", "Original text", "Corrected text", "Waze location",
              "Coordinates", "Leg driving distance from previous stop (m)"]
ws.append(out_header)

header_font = Font(b=True)
header_fill = PatternFill(patternType="solid", fgColor="00D9E1F2")
for c in range(1, len(out_header) + 1):
    cell = ws.cell(1, c)
    cell.font = header_font
    cell.fill = header_fill

link_font = Font(color="000563C1", u="single")
wrap_center = Alignment(vertical="center", wrapText=True)

excel_row = 2
for day_num, order, length in day_results:
    for stop_num, pt_idx in enumerate(order, start=1):
        row = valid[pt_idx]["row"]
        leg = None
        if stop_num > 1:
            prev_idx = order[stop_num - 2]
            leg = round(D[prev_idx][pt_idx])
        ws.cell(excel_row, 1, day_num)
        ws.cell(excel_row, 2, stop_num)
        ws.cell(excel_row, 3, row[0])
        ws.cell(excel_row, 4, row[1])
        wcell = ws.cell(excel_row, 5, row[2])
        if isinstance(row[2], str) and row[2].startswith("http"):
            wcell.hyperlink = row[2]
            wcell.font = link_font
        ws.cell(excel_row, 6, row[3])
        ws.cell(excel_row, 7, leg if leg is not None else None)
        for c in range(1, 8):
            ws.cell(excel_row, c).alignment = wrap_center
        excel_row += 1

for row in invalid:
    ws.cell(excel_row, 1, "Unscheduled")
    ws.cell(excel_row, 2, None)
    ws.cell(excel_row, 3, row[0])
    ws.cell(excel_row, 4, row[1])
    ws.cell(excel_row, 5, row[2])
    ws.cell(excel_row, 6, row[3])
    ws.cell(excel_row, 7, None)
    for c in range(1, 8):
        ws.cell(excel_row, c).alignment = wrap_center
    excel_row += 1

widths = {"A": 12, "B": 8, "C": 30, "D": 42, "E": 46, "F": 22, "G": 34}
for col, w in widths.items():
    ws.column_dimensions[col].width = w

ws2 = wb.create_sheet("Summary")
ws2.sheet_view.rightToLeft = True
ws2.append(["Day", "Stops", "Total driving distance (m)", "Total driving distance (km)"])
for c in range(1, 5):
    cell = ws2.cell(1, c)
    cell.font = header_font
    cell.fill = header_fill
for day_num, order, length in day_results:
    ws2.append([day_num, len(order), round(length), round(length / 1000, 1)])
ws2.append(["Unscheduled", len(invalid), None, None])
ws2.append([])
ws2.append(["Day-count option", "Total driving distance (km)"])
for k in sorted(results_by_k):
    t = results_by_k[k][0]
    ws2.append([k, round(t / 1000, 1) if t is not None else None])
for col, w in {"A": 18, "B": 10, "C": 22, "D": 22}.items():
    ws2.column_dimensions[col].width = w

wb.save(OUT_XLSX)
print("wrote", OUT_XLSX)
