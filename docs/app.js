(function () {
  "use strict";

  var DATA = window.APP_DATA || { days: [], unscheduled: [], allBranches: [] };

  var WAZE_ICON =
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C7.03 2 3 6.03 3 11c0 4.17 5.4 9.92 7.6 12.06.78.76 2.02.76 2.8 0C15.6 20.92 21 15.17 21 11c0-4.97-4.03-9-9-9zm0 12.2a3.2 3.2 0 1 1 0-6.4 3.2 3.2 0 0 1 0 6.4z"/></svg>';

  // ---------------- theme ----------------
  var root = document.documentElement;
  var savedTheme = localStorage.getItem("theme");
  if (savedTheme) root.setAttribute("data-theme", savedTheme);

  document.getElementById("themeToggle").addEventListener("click", function () {
    var current = root.getAttribute("data-theme");
    var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    var effectiveDark = current ? current === "dark" : prefersDark;
    var next = effectiveDark ? "light" : "dark";
    root.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
  });

  // ---------------- tabs ----------------
  var tabButtons = document.querySelectorAll(".tab-btn");
  var views = { route: document.getElementById("view-route"), all: document.getElementById("view-all") };

  tabButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      tabButtons.forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      Object.keys(views).forEach(function (k) { views[k].classList.remove("active"); });
      views[btn.dataset.view].classList.add("active");
    });
  });

  // ---------------- helpers ----------------
  function fmtKm(m) {
    return (m / 1000).toLocaleString("he-IL", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  }

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function wazeButton(url, label) {
    if (!url || url === "TODO") {
      return '<span class="coord-pill">אין מיקום ב-Waze</span>';
    }
    return (
      '<a class="waze-btn" href="' + url + '" target="_blank" rel="noopener">' +
      WAZE_ICON + "<span>" + (label || "נווט ב-Waze") + "</span></a>"
    );
  }

  function coordPill(coords) {
    if (!coords) return "";
    return '<span class="coord-pill">' + coords.lat.toFixed(5) + ", " + coords.lon.toFixed(5) + "</span>";
  }

  // ---------------- day strip ----------------
  var dayStrip = document.getElementById("dayStrip");
  var activeDay = DATA.days.length ? DATA.days[0].day : null;

  function renderDayStrip() {
    dayStrip.innerHTML = "";
    DATA.days.forEach(function (d) {
      var chip = el("div", "day-chip" + (d.day === activeDay ? " active" : ""));
      chip.innerHTML =
        '<div class="day-chip-label">יום</div>' +
        '<div class="day-chip-num">' + d.day + "</div>" +
        '<div class="day-chip-meta">' + d.stops.length + " עצירות · " + fmtKm(d.totalDistanceM) + ' ק"מ</div>';
      chip.addEventListener("click", function () {
        activeDay = d.day;
        renderDayStrip();
        renderRoute();
      });
      dayStrip.appendChild(chip);
    });

    if (DATA.unscheduled && DATA.unscheduled.length) {
      var chip = el("div", "day-chip" + (activeDay === "unscheduled" ? " active" : ""));
      chip.innerHTML =
        '<div class="day-chip-label">—</div>' +
        '<div class="day-chip-num" style="font-size:16px">לא משובץ</div>' +
        '<div class="day-chip-meta">' + DATA.unscheduled.length + " סניפים</div>";
      chip.addEventListener("click", function () {
        activeDay = "unscheduled";
        renderDayStrip();
        renderRoute();
      });
      dayStrip.appendChild(chip);
    }
  }

  // ---------------- route view ----------------
  var dayHeaderEl = document.getElementById("dayHeader");
  var routeLineEl = document.getElementById("routeLine");
  var unscheduledBoxEl = document.getElementById("unscheduledBox");

  function renderStopCard(stop, index) {
    var wrap = el("div");
    if (index > 0 && stop.legDistanceM != null) {
      wrap.appendChild(
        el(
          "div",
          "leg-connector",
          '<span class="arrow">↓</span> ' +
            stop.legDistanceM.toLocaleString("he-IL") +
            " מ' מהעצירה הקודמת"
        )
      );
    }
    var card = el("div", "stop-card");
    card.style.animationDelay = index * 0.03 + "s";
    card.innerHTML =
      '<div class="stop-badge">' + stop.stop + "</div>" +
      '<div class="stop-body">' +
      '<p class="stop-title">' + stop.correctedText + "</p>" +
      '<p class="stop-orig">' + stop.originalText + "</p>" +
      '<div class="stop-actions">' + wazeButton(stop.wazeUrl) + coordPill(stop.coordinates) + "</div>" +
      "</div>";
    wrap.appendChild(card);
    return wrap;
  }

  function renderRoute() {
    dayHeaderEl.innerHTML = "";
    routeLineEl.innerHTML = "";
    unscheduledBoxEl.innerHTML = "";

    if (activeDay === "unscheduled") {
      dayHeaderEl.innerHTML =
        '<div class="day-header"><h1>לא משובץ</h1></div>';
      DATA.unscheduled.forEach(function (item) {
        var box = el("div", "stop-card");
        box.style.gridTemplateColumns = "1fr";
        box.innerHTML =
          '<div class="stop-body">' +
          '<p class="stop-title">' + item.correctedText + "</p>" +
          '<p class="stop-orig">' + item.originalText + "</p>" +
          '<div class="stop-actions">' + wazeButton(item.wazeUrl) + "</div>" +
          "</div>";
        routeLineEl.appendChild(box);
      });
      return;
    }

    var day = DATA.days.find(function (d) { return d.day === activeDay; });
    if (!day) return;

    dayHeaderEl.innerHTML =
      '<div class="day-header"><h1>יום ' + day.day + "</h1>" +
      '<div class="stat-row">' +
      '<div class="stat"><div class="stat-num">' + day.stops.length + '</div><div class="stat-label">עצירות</div></div>' +
      '<div class="stat"><div class="stat-num">' + fmtKm(day.totalDistanceM) + '</div><div class="stat-label">ק"מ</div></div>' +
      "</div></div>";

    day.stops.forEach(function (stop, i) {
      routeLineEl.appendChild(renderStopCard(stop, i));
    });
    routeLineEl.appendChild(el("div", "day-end", "סוף מסלול"));
  }

  // ---------------- all branches view ----------------
  var branchListEl = document.getElementById("branchList");
  var branchCountEl = document.getElementById("branchCount");
  var searchInput = document.getElementById("searchInput");

  function renderBranchList() {
    var q = (searchInput.value || "").trim().toLowerCase();
    var items = DATA.allBranches.filter(function (b) {
      if (!q) return true;
      return (
        (b.correctedText || "").toLowerCase().indexOf(q) !== -1 ||
        (b.originalText || "").toLowerCase().indexOf(q) !== -1
      );
    });

    branchCountEl.textContent = items.length + " מתוך " + DATA.allBranches.length + " סניפים";
    branchListEl.innerHTML = "";

    items.forEach(function (b) {
      var row = el("div", "branch-row");
      var dayTag = b.day
        ? '<span class="day-tag">יום ' + b.day + " · #" + b.stop + "</span>"
        : '<span class="day-tag none">לא משובץ</span>';
      var linkHtml =
        b.wazeUrl && b.wazeUrl !== "TODO"
          ? '<a class="mini-waze" href="' + b.wazeUrl + '" target="_blank" rel="noopener" title="נווט ב-Waze">' + WAZE_ICON + "</a>"
          : '<span class="no-link"></span>';
      row.innerHTML =
        '<div class="branch-row-main">' +
        '<p class="branch-row-title">' + b.correctedText + "</p>" +
        '<p class="branch-row-sub">' + b.originalText + "</p>" +
        "</div>" +
        '<div class="branch-tags">' + dayTag + linkHtml + "</div>";
      branchListEl.appendChild(row);
    });
  }

  searchInput.addEventListener("input", renderBranchList);

  // ---------------- init ----------------
  renderDayStrip();
  renderRoute();
  renderBranchList();
})();
