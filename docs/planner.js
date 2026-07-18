// Client-side day-route planner: capacitated k-medoids clustering + exact/heuristic
// per-day ordering, all driven by the real driving-distance matrix baked into data.js.
// Mirrors scripts/build_day_routes.py but reimplemented in JS to run interactively.
(function () {
  "use strict";

  var EXACT_LIMIT = 7; // brute-force permutations up to this many stops/day; heuristic above
  var RESTARTS = 4;
  var MAX_K_SAMPLES = 5;
  var TIME_BUDGET_MS = 6000; // hard cap so the UI thread can never truly hang

  function fmtNum(n) {
    return n.toLocaleString("he-IL");
  }

  function sampleRange(lo, hi, maxSamples) {
    if (hi - lo + 1 <= maxSamples) {
      var all = [];
      for (var k = lo; k <= hi; k++) all.push(k);
      return all;
    }
    var out = [];
    for (var i = 0; i < maxSamples; i++) {
      var k = Math.round(lo + (i * (hi - lo)) / (maxSamples - 1));
      if (out.indexOf(k) === -1) out.push(k);
    }
    return out;
  }

  function makeDistFn(Dm) {
    // Dm: (n+1)x(n+1), index 0 = depot, 1..n = points. Returns helpers using 0-based point indices.
    return {
      pt: function (i, j) { return Dm[i + 1][j + 1]; },
      depotTo: function (i) { return Dm[0][i + 1]; },
      toDepot: function (i) { return Dm[i + 1][0]; },
    };
  }

  function recomputeMedoid(members, D) {
    if (members.length === 1) return members[0];
    var best = null, bestSum = Infinity;
    for (var mi = 0; mi < members.length; mi++) {
      var m = members[mi], sum = 0;
      for (var ii = 0; ii < members.length; ii++) sum += D.pt(m, members[ii]);
      if (sum < bestSum) { bestSum = sum; best = m; }
    }
    return best;
  }

  function seededRng(seed) {
    var s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return function () {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  function seedMedoids(k, n, D, rng) {
    var medoids = [Math.floor(rng() * n)];
    while (medoids.length < k) {
      var d2 = [];
      var total = 0;
      for (var i = 0; i < n; i++) {
        var dmin = Infinity;
        for (var mi = 0; mi < medoids.length; mi++) dmin = Math.min(dmin, D.pt(medoids[mi], i));
        var v = dmin * dmin;
        d2.push(v);
        total += v;
      }
      var r = total > 0 ? rng() * total : 0;
      var acc = 0, chosen = null;
      for (var j = 0; j < n; j++) {
        acc += d2[j];
        if (acc >= r) { chosen = j; break; }
      }
      medoids.push(chosen != null ? chosen : Math.floor(rng() * n));
    }
    return medoids;
  }

  function capacitatedKMedoids(k, n, D, seed) {
    var rng = seededRng(seed * 97 + 13);
    var medoids = seedMedoids(k, n, D, rng);
    var clusters = {};
    for (var iter = 0; iter < 30; iter++) {
      var assign = [];
      for (var i = 0; i < n; i++) {
        var bestC = 0, bestD = Infinity;
        for (var c = 0; c < k; c++) {
          var dd = D.pt(medoids[c], i);
          if (dd < bestD) { bestD = dd; bestC = c; }
        }
        assign.push(bestC);
      }
      clusters = {};
      for (c = 0; c < k; c++) clusters[c] = [];
      for (i = 0; i < n; i++) clusters[assign[i]].push(i);
      var changed = false;
      var newMedoids = [];
      for (c = 0; c < k; c++) {
        var nm = clusters[c].length ? recomputeMedoid(clusters[c], D) : medoids[c];
        if (nm !== medoids[c]) changed = true;
        newMedoids.push(nm);
      }
      medoids = newMedoids;
      if (!changed) break;
    }
    return clusters;
  }

  function enforceCapacity(clusters, minSize, maxSize, D) {
    var out = {};
    Object.keys(clusters).forEach(function (c) { out[c] = clusters[c].slice(); });
    var ids = Object.keys(out);

    function medoidOf(c) { return out[c].length ? recomputeMedoid(out[c], D) : null; }

    for (var iter = 0; iter < 2000; iter++) {
      var over = ids.filter(function (c) { return out[c].length > maxSize; });
      if (over.length) {
        var c = over[0];
        var m = medoidOf(c);
        var worst = out[c][0], worstD = -1;
        out[c].forEach(function (i) { var d = D.pt(m, i); if (d > worstD) { worstD = d; worst = i; } });
        var candidates = ids.filter(function (cj) { return cj !== c && out[cj].length < maxSize; });
        if (!candidates.length) break;
        var target = candidates[0], targetD = Infinity;
        candidates.forEach(function (cj) {
          var mj = medoidOf(cj);
          var d = mj == null ? 0 : D.pt(mj, worst);
          if (d < targetD) { targetD = d; target = cj; }
        });
        out[c] = out[c].filter(function (x) { return x !== worst; });
        out[target].push(worst);
        continue;
      }
      var under = ids.filter(function (c) { return out[c].length < minSize; });
      if (under.length) {
        var cu = under[0];
        var mu = medoidOf(cu);
        var donors = [];
        ids.forEach(function (cj) {
          if (cj !== cu && out[cj].length > minSize) {
            out[cj].forEach(function (i) { donors.push([cj, i]); });
          }
        });
        if (!donors.length) break;
        var best = donors[0], bestDd = Infinity;
        donors.forEach(function (pair) {
          var d = mu == null ? 0 : D.pt(mu, pair[1]);
          if (d < bestDd) { bestDd = d; best = pair; }
        });
        out[best[0]] = out[best[0]].filter(function (x) { return x !== best[1]; });
        out[cu].push(best[1]);
        continue;
      }
      break;
    }
    return out;
  }

  function swapRefine(clusters, D, passes) {
    var out = {};
    Object.keys(clusters).forEach(function (c) { out[c] = clusters[c].slice(); });
    var ids = Object.keys(out);
    for (var p = 0; p < passes; p++) {
      var improved = false;
      var medoids = {};
      ids.forEach(function (c) { medoids[c] = out[c].length ? recomputeMedoid(out[c], D) : null; });
      outer:
      for (var a = 0; a < ids.length; a++) {
        for (var b = a + 1; b < ids.length; b++) {
          var ca = ids[a], cb = ids[b];
          for (var ii = 0; ii < out[ca].length; ii++) {
            for (var jj = 0; jj < out[cb].length; jj++) {
              var i = out[ca][ii], j = out[cb][jj];
              var cur = D.pt(medoids[ca], i) + D.pt(medoids[cb], j);
              var neu = D.pt(medoids[ca], j) + D.pt(medoids[cb], i);
              if (neu < cur - 1e-6) {
                out[ca][ii] = j;
                out[cb][jj] = i;
                medoids[ca] = recomputeMedoid(out[ca], D);
                medoids[cb] = recomputeMedoid(out[cb], D);
                improved = true;
                continue outer;
              }
            }
          }
        }
      }
      if (!improved) break;
    }
    return out;
  }

  // Heap's algorithm, in-place (mutates `arr` between calls to `visit`, restores it at the end).
  // Avoids allocating O(n!) intermediate arrays the way a naive recursive generator would.
  function forEachPermutation(arr, visit) {
    var n = arr.length;
    var c = new Array(n).fill(0);
    visit(arr);
    var i = 0;
    while (i < n) {
      if (c[i] < i) {
        var swapIdx = i % 2 === 0 ? 0 : c[i];
        var tmp = arr[swapIdx];
        arr[swapIdx] = arr[i];
        arr[i] = tmp;
        visit(arr);
        c[i]++;
        i = 0;
      } else {
        c[i] = 0;
        i++;
      }
    }
  }

  // Exact best depot->...->depot order; returns null if maxLegM set and no permutation satisfies it.
  function exactOrder(members, D, maxLegM) {
    if (members.length === 0) return { order: [], length: 0, legs: [] };
    if (members.length === 1) {
      var i = members[0];
      var d0 = D.depotTo(i), d1 = D.toDepot(i);
      if (maxLegM != null && (d0 > maxLegM || d1 > maxLegM)) return null;
      return { order: members, length: d0 + d1, legs: [d0, d1] };
    }
    var best = null;
    forEachPermutation(members.slice(), function (perm) {
      var legs = [D.depotTo(perm[0])];
      if (maxLegM != null && legs[0] > maxLegM) return;
      var total = legs[0];
      for (var k = 0; k < perm.length - 1; k++) {
        var leg = D.pt(perm[k], perm[k + 1]);
        if (maxLegM != null && leg > maxLegM) return;
        legs.push(leg);
        total += leg;
      }
      var lastLeg = D.toDepot(perm[perm.length - 1]);
      if (maxLegM != null && lastLeg > maxLegM) return;
      legs.push(lastLeg);
      total += lastLeg;
      if (!best || total < best.length) best = { order: perm.slice(), length: total, legs: legs };
    });
    return best;
  }

  // Nearest-neighbour + 2-opt heuristic for larger day sizes; respects maxLegM by rejecting
  // any move that would use a forbidden edge. Returns null if it can't build a full valid tour.
  function heuristicOrder(members, D, maxLegM) {
    var remaining = members.slice();
    var order = [];
    var cur = null; // null = depot
    while (remaining.length) {
      var bestIdx = -1, bestD = Infinity;
      for (var i = 0; i < remaining.length; i++) {
        var d = cur == null ? D.depotTo(remaining[i]) : D.pt(cur, remaining[i]);
        if (maxLegM != null && d > maxLegM) continue;
        if (d < bestD) { bestD = d; bestIdx = i; }
      }
      if (bestIdx === -1) return null; // stuck: no reachable next stop under the constraint
      cur = remaining[bestIdx];
      order.push(cur);
      remaining.splice(bestIdx, 1);
    }
    if (maxLegM != null && D.toDepot(order[order.length - 1]) > maxLegM) return null;

    function tourLegs(ord) {
      var legs = [D.depotTo(ord[0])];
      for (var k = 0; k < ord.length - 1; k++) legs.push(D.pt(ord[k], ord[k + 1]));
      legs.push(D.toDepot(ord[ord.length - 1]));
      return legs;
    }
    function tourLength(ord) {
      return tourLegs(ord).reduce(function (a, b) { return a + b; }, 0);
    }
    function violatesMax(ord) {
      if (maxLegM == null) return false;
      return tourLegs(ord).some(function (l) { return l > maxLegM; });
    }

    var improved = true;
    while (improved) {
      improved = false;
      for (var a = 0; a < order.length - 1; a++) {
        for (var b = a + 1; b < order.length; b++) {
          var candidate = order.slice(0, a).concat(order.slice(a, b + 1).reverse(), order.slice(b + 1));
          if (violatesMax(candidate)) continue;
          if (tourLength(candidate) < tourLength(order) - 1e-6) {
            order = candidate;
            improved = true;
          }
        }
      }
    }
    return { order: order, length: tourLength(order), legs: tourLegs(order) };
  }

  function bestDayOrder(members, D, maxLegM) {
    if (members.length <= EXACT_LIMIT) return exactOrder(members, D, maxLegM);
    return heuristicOrder(members, D, maxLegM);
  }

  function evaluateClusters(clusters, D, maxLegM) {
    var total = 0;
    var orders = {};
    var ids = Object.keys(clusters);
    for (var i = 0; i < ids.length; i++) {
      var c = ids[i];
      var res = bestDayOrder(clusters[c], D, maxLegM);
      if (!res) return null;
      orders[c] = res;
      total += res.length;
    }
    return { total: total, orders: orders };
  }

  function nearestNeighborDistances(n, D) {
    var out = [];
    for (var i = 0; i < n; i++) {
      var best = Infinity;
      for (var j = 0; j < n; j++) {
        if (i === j) continue;
        best = Math.min(best, D.pt(i, j));
      }
      out.push(best);
    }
    return out;
  }

  function plan(options) {
    var data = window.APP_DATA;
    if (!data || !data.planner) return { ok: false, error: "נתוני התכנון חסרים בעמוד." };
    var points = data.planner.points;
    var Dm = data.planner.distances;
    var Tm = data.planner.durations;
    var D = makeDistFn(Dm);
    var T = Tm ? makeDistFn(Tm) : null;
    var n = points.length;

    var minPerDay = options.minPerDay, maxPerDay = options.maxPerDay;
    var numDays = options.numDays || null;
    var maxLegKm = options.maxLegKm || null;
    var maxLegM = maxLegKm != null ? maxLegKm * 1000 : null;

    if (!Number.isFinite(minPerDay) || minPerDay < 1) {
      return { ok: false, error: 'מינימום עצירות ליום חייב להיות מספר שלם של לפחות 1.' };
    }
    if (!Number.isFinite(maxPerDay) || maxPerDay < minPerDay) {
      return { ok: false, error: 'מקסימום עצירות ליום חייב להיות גדול או שווה למינימום.' };
    }

    if (maxLegM != null) {
      var minDepotLeg = Infinity, minDepotName = null;
      for (var pi = 0; pi < n; pi++) {
        var dd = D.depotTo(pi);
        if (dd < minDepotLeg) { minDepotLeg = dd; minDepotName = points[pi].correctedText; }
      }
      if (minDepotLeg > maxLegM) {
        return {
          ok: false,
          error: 'מרחק הנסיעה המקסימלי (' + maxLegKm + ' ק"מ) קטן מהמרחק מהבסיס לסניף הקרוב ביותר אליו (' +
            minDepotName + ', ' + (minDepotLeg / 1000).toFixed(1) + ' ק"מ) — לא ניתן להתחיל אף יום במגבלה זו.',
        };
      }
    }

    var kRange;
    if (numDays) {
      if (!Number.isFinite(numDays) || numDays < 1) {
        return { ok: false, error: 'מספר הימים חייב להיות מספר שלם חיובי.' };
      }
      var minCap = minPerDay * numDays, maxCap = maxPerDay * numDays;
      if (n < minCap || n > maxCap) {
        return {
          ok: false,
          error: fmtNum(n) + ' סניפים לא מתחלקים ל-' + numDays + ' ימים עם ' + minPerDay + '-' + maxPerDay +
            ' עצירות ליום (טווח אפשרי עם ' + numDays + ' ימים: ' + fmtNum(minCap) + '-' + fmtNum(maxCap) + ' סניפים). ' +
            (n < minCap ? 'נסה פחות ימים או מינימום נמוך יותר.' : 'נסה יותר ימים או מקסימום גבוה יותר.'),
        };
      }
      kRange = [numDays];
    } else {
      var kMin = Math.ceil(n / maxPerDay), kMax = Math.floor(n / minPerDay);
      if (kMin > kMax) {
        return {
          ok: false,
          error: 'לא ניתן לחלק ' + fmtNum(n) + ' סניפים לימים עם ' + minPerDay + '-' + maxPerDay +
            ' עצירות ליום: יום בודד לא מכיל את כולם (מקסימום ' + maxPerDay + '), אבל כבר ' + kMin +
            ' ימים דורשים לפחות ' + fmtNum(kMin * minPerDay) + ' עצירות (מינימום ' + minPerDay + ' ליום). ' +
            'צמצם את הפער בין המינימום למקסימום או הגדל את המקסימום.',
        };
      }
      kRange = sampleRange(kMin, kMax, MAX_K_SAMPLES);
    }

    if (maxLegM != null && minPerDay > 1) {
      var nn = nearestNeighborDistances(n, D);
      var offenders = [];
      for (var i = 0; i < n; i++) {
        if (nn[i] > maxLegM) {
          offenders.push(points[i].correctedText + ' (השכן הקרוב ביותר במרחק ' + (nn[i] / 1000).toFixed(1) + ' ק"מ)');
        }
      }
      if (offenders.length) {
        return {
          ok: false,
          error: 'הסניפים הבאים אין להם שכן במרחק נסיעה של עד ' + maxLegKm + ' ק"מ, ולכן אי אפשר לשבץ אותם ' +
            'כשמינימום העצירות ליום גדול מ-1: ' + offenders.slice(0, 5).join('; ') +
            (offenders.length > 5 ? ' ועוד ' + (offenders.length - 5) + ' סניפים' : '') +
            '. הגדל את מרחק הנסיעה המקסימלי, או הורד את מינימום העצירות ליום ל-1.',
        };
      }
    }

    var best = null;
    var deadline = Date.now() + TIME_BUDGET_MS;
    searchLoop:
    for (var ki = 0; ki < kRange.length; ki++) {
      var k = kRange[ki];
      if (k > n) continue;
      for (var seed = 0; seed < RESTARTS; seed++) {
        if (Date.now() > deadline) break searchLoop; // hard cap: never freeze the UI, use best-so-far
        var clusters = capacitatedKMedoids(k, n, D, seed);
        clusters = enforceCapacity(clusters, minPerDay, maxPerDay, D);
        if (!Object.keys(clusters).every(function (c) { return clusters[c].length >= minPerDay && clusters[c].length <= maxPerDay; })) continue;
        clusters = swapRefine(clusters, D, 10);
        if (!Object.keys(clusters).every(function (c) { return clusters[c].length >= minPerDay && clusters[c].length <= maxPerDay; })) continue;
        var evald = evaluateClusters(clusters, D, maxLegM);
        if (!evald) continue;
        if (!best || evald.total < best.total) best = { clusters: clusters, evald: evald, k: k };
      }
    }

    if (!best) {
      var msg = 'לא נמצא פיצול תקין לפי המגבלות שהוגדרו.';
      if (maxLegM != null) msg += ' נסה להגדיל את מרחק הנסיעה המקסימלי בין עצירות, או לצמצם את טווח העצירות ליום.';
      else msg += ' נסה טווח עצירות רחב יותר או מספר ימים אחר.';
      return { ok: false, error: msg };
    }

    function durationLegs(order) {
      if (!T) return order.map(function () { return null; }).concat([null]);
      var legs = [T.depotTo(order[0])];
      for (var k = 0; k < order.length - 1; k++) legs.push(T.pt(order[k], order[k + 1]));
      legs.push(T.toDepot(order[order.length - 1]));
      return legs;
    }

    var ids = Object.keys(best.clusters);
    var dayObjs = ids.map(function (c) {
      var members = best.clusters[c];
      var res = best.evald.orders[c];
      var durLegs = durationLegs(res.order);
      return {
        members: res.order.map(function (idx) { return points[idx]; }),
        legs: res.legs, // length = members.length + 1 (depot->first ... last->depot), meters
        durationLegs: durLegs, // seconds, same shape
        totalDistanceM: res.length,
        totalDurationS: durLegs[0] == null ? null : durLegs.reduce(function (a, b) { return a + b; }, 0),
        avgLat: members.reduce(function (s, i) { return s + (points[i].coordinates ? points[i].coordinates.lat : 0); }, 0) / members.length,
      };
    });
    dayObjs.sort(function (a, b) { return b.avgLat - a.avgLat; });

    return {
      ok: true,
      totalDistanceM: best.evald.total,
      days: dayObjs.map(function (d, idx) {
        return {
          day: idx + 1,
          members: d.members,
          legs: d.legs,
          durationLegs: d.durationLegs,
          totalDistanceM: d.totalDistanceM,
          totalDurationS: d.totalDurationS,
        };
      }),
    };
  }

  window.Planner = { plan: plan };
})();
