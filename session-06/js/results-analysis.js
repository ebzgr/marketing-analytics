/**
 * Session 6: analysis of the Dream Destinations conjoint results.
 *
 * Data: one row per (respondent, rated trip) with columns
 *   Respondent, <attribute 1>, ..., <attribute k>, Rating   (rating on a 1-7 scale)
 * Loaded from assets/Dream Destination data.csv, or from a CSV / Excel file chosen in class.
 *
 * Pipeline
 *  1. One OLS regression per respondent: Rating ~ dummy-coded attribute levels.
 *  2. Partworths are zero-centered within each attribute (rating points above / below the attribute average).
 *  3. Importance of an attribute = range of its partworths / sum of ranges, per respondent, then averaged.
 *  4. k-means (k-means++, several restarts, fixed seed) on the individual partworth vectors.
 *     The suggested k is the elbow of the within-cluster sum of squares (largest distance to the chord).
 *
 * Slides use: [data-res-data], [data-res-importance], [data-res-levels], [data-res-k], [data-res-segments].
 */
(function () {
  var DATA_URL = "assets/Dream%20Destination%20data.csv";
  var K_MAX = 8;
  var KMEANS_RESTARTS = 300;   // k-means++ restarts per k; the best (lowest within-segment SS) is kept
  var K_CHOICES = [2, 3, 4, 5, 6];
  var DEFAULT_K = 4;     // no clear elbow in the class data: we go with 4 segments

  // Preferred display order of levels (matched on the start of the lower-cased label).
  var ORDER_HINTS = [
    "beach", "mountain", "metropolitan", "historical",
    "camp", "hostel", "standard (", "luxury",
    "no meal", "breakfast", "standard 3", "all-inclusive",
    "party", "train", "airplane", "plane",
    "none", "professional photographer", "dj", "photographer+"
  ];

  var state = { result: null, k: null, seg: {}, teams: [], rule: "first", beta: 1 };
  var TEAM_KEY = "ma-s6-team-bundles";

  /* Team bundles are kept by level label so they survive reloading a new data file.
     They are also kept in this browser (localStorage) so a page refresh in class does not lose them. */
  function loadTeams() {
    try { var t = JSON.parse(localStorage.getItem(TEAM_KEY) || "[]"); if (Array.isArray(t)) state.teams = t; } catch (e) { state.teams = []; }
  }
  function saveTeams() {
    try { localStorage.setItem(TEAM_KEY, JSON.stringify(state.teams)); } catch (e) { /* storage unavailable: keep in memory */ }
  }

  /* ---------- small helpers ---------- */
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function svgEl(tag, attrs) {
    var e = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (var a in attrs) e.setAttribute(a, attrs[a]);
    return e;
  }
  function fmt(v, d) { return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d == null ? 2 : d); }
  function pct(v) { return Math.round(v * 100) + "%"; }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /** Drops "(10 people rooms)" / "(12-14 hours)" style details for compact labels; keeps "(London)". */
  function shortLabel(label) {
    var m = label.match(/^(.*?)\s*\((.*)\)\s*$/);
    if (m && m[1].length >= 3 && /people|hour|room|tent|min/i.test(m[2])) return m[1];
    return label;
  }
  function orderRank(label) {
    var l = label.toLowerCase();
    for (var i = 0; i < ORDER_HINTS.length; i++) if (l.indexOf(ORDER_HINTS[i]) === 0) return i;
    return 999;
  }

  /* ---------- parsing ---------- */
  function parseCSV(text) {
    var rows = [], row = [], field = "", q = false;
    text = text.replace(/^﻿/, "");
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.some(function (x) { return x !== ""; })) rows.push(row);
        row = [];
      } else field += c;
    }
    row.push(field);
    if (row.some(function (x) { return x !== ""; })) rows.push(row);
    return rows;
  }

  /** Turns a table (array of rows, first row = header) into a clean dataset. */
  function toDataset(table) {
    var header = table[0].map(function (h) { return String(h).trim(); });
    var rIdx = header.findIndex(function (h) { return /respond|participant|^id$|name/i.test(h); });
    if (rIdx < 0) rIdx = 0;
    var yIdx = header.findIndex(function (h) { return /rating|score|preference/i.test(h); });
    if (yIdx < 0) yIdx = header.length - 1;
    var attrIdx = header.map(function (_, i) { return i; }).filter(function (i) { return i !== rIdx && i !== yIdx; });
    var obs = [];
    table.slice(1).forEach(function (r) {
      var y = parseFloat(r[yIdx]);
      var id = r[rIdx] == null ? "" : String(r[rIdx]).trim();
      if (!isFinite(y) || !id) return;
      obs.push({
        id: id,
        y: y,
        levels: attrIdx.map(function (i) {
          var v = r[i] == null ? "" : String(r[i]).trim();
          return v === "" ? "None" : v;
        })
      });
    });
    var attrs = attrIdx.map(function (i, a) {
      var seen = {};
      obs.forEach(function (o) { seen[o.levels[a]] = true; });
      var levels = Object.keys(seen).sort(function (x, y) {
        return orderRank(x) - orderRank(y) || x.localeCompare(y);
      });
      return { name: header[i], levels: levels };
    });
    return { attrs: attrs, obs: obs };
  }

  /* ---------- estimation ---------- */
  function ols(X, y) {
    var k = X[0].length, A = [], i, j, r;
    for (i = 0; i < k; i++) {
      A.push(new Array(k + 1).fill(0));
      for (r = 0; r < X.length; r++) {
        for (j = 0; j < k; j++) A[i][j] += X[r][i] * X[r][j];
        A[i][k] += X[r][i] * y[r];
      }
    }
    for (var c = 0; c < k; c++) {
      var p = c;
      for (r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      if (Math.abs(A[p][c]) < 1e-8) return null;
      var t = A[c]; A[c] = A[p]; A[p] = t;
      for (r = 0; r < k; r++) {
        if (r === c) continue;
        var f = A[r][c] / A[c][c];
        for (j = c; j <= k; j++) A[r][j] -= f * A[c][j];
      }
    }
    return A.map(function (row, i2) { return row[k] / row[i2]; });
  }

  function analyze(ds) {
    var attrs = ds.attrs;
    var byId = {}, ids = [];
    ds.obs.forEach(function (o) {
      if (!byId[o.id]) { byId[o.id] = []; ids.push(o.id); }
      byId[o.id].push(o);
    });
    var used = [];
    ids.forEach(function (id) { used = used.concat(byId[id]); });
    var nParams = 1 + attrs.reduce(function (s, a) { return s + a.levels.length - 1; }, 0);
    var people = [], skipped = 0;
    ids.forEach(function (id) {
      var rows = byId[id];
      if (rows.length <= nParams) { skipped++; return; }
      var X = rows.map(function (o) {
        var x = [1];
        attrs.forEach(function (a, ai) {
          for (var l = 1; l < a.levels.length; l++) x.push(o.levels[ai] === a.levels[l] ? 1 : 0);
        });
        return x;
      });
      var b = ols(X, rows.map(function (o) { return o.y; }));
      if (!b) { skipped++; return; }
      var pw = [], ranges = [], off = 1, base = b[0];
      attrs.forEach(function (a) {
        var v = [0];
        for (var l = 1; l < a.levels.length; l++) v.push(b[off + l - 1]);
        off += a.levels.length - 1;
        var m = v.reduce(function (s, x) { return s + x; }, 0) / v.length;
        base += m;
        v = v.map(function (x) { return x - m; });
        pw = pw.concat(v);
        ranges.push(Math.max.apply(null, v) - Math.min.apply(null, v));
      });
      var tot = ranges.reduce(function (s, x) { return s + x; }, 0);
      people.push({ id: id, base: base, pw: pw, imp: ranges.map(function (r) { return tot > 0 ? r / tot : 0; }) });
    });

    var dim = people.length ? people[0].pw.length : 0;
    var meanPw = new Array(dim).fill(0), meanImp = new Array(attrs.length).fill(0);
    people.forEach(function (p) {
      p.pw.forEach(function (v, i) { meanPw[i] += v / people.length; });
      p.imp.forEach(function (v, i) { meanImp[i] += v / people.length; });
    });
    var offsets = [], o2 = 0;
    attrs.forEach(function (a) { offsets.push(o2); o2 += a.levels.length; });

    var res = {
      attrs: attrs, offsets: offsets, people: people, skipped: skipped,
      nObs: used.length, nIds: ids.length, meanPw: meanPw, meanImp: meanImp,
      sample: used.slice(0, 5),
      perPerson: median(ids.map(function (id) { return byId[id].length; })),
      yMin: Math.min.apply(null, used.map(function (o) { return o.y; })),
      yMax: Math.max.apply(null, used.map(function (o) { return o.y; }))
    };
    clusterAll(res);
    return res;
  }

  function median(a) {
    var s = a.slice().sort(function (x, y) { return x - y; });
    return s.length ? s[Math.floor(s.length / 2)] : 0;
  }

  /* ---------- k-means ---------- */
  function dist2(a, b) {
    var s = 0;
    for (var i = 0; i < a.length; i++) { var d = a[i] - b[i]; s += d * d; }
    return s;
  }

  function kmeansOnce(P, k, rng) {
    var n = P.length, C = [P[Math.floor(rng() * n)].slice()];
    while (C.length < k) {
      var d = P.map(function (p) { return Math.min.apply(null, C.map(function (c) { return dist2(p, c); })); });
      var tot = d.reduce(function (s, x) { return s + x; }, 0), r = rng() * tot, i = 0;
      while (i < n - 1 && (r -= d[i]) > 0) i++;
      C.push(P[i].slice());
    }
    var lab = new Array(n).fill(-1);
    for (var it = 0; it < 100; it++) {
      var changed = false;
      P.forEach(function (p, i2) {
        var best = 0, bd = Infinity;
        C.forEach(function (c, j) { var dd = dist2(p, c); if (dd < bd) { bd = dd; best = j; } });
        if (lab[i2] !== best) { lab[i2] = best; changed = true; }
      });
      C = C.map(function (c, j) {
        var m = new Array(c.length).fill(0), cnt = 0;
        P.forEach(function (p, i3) { if (lab[i3] === j) { cnt++; p.forEach(function (v, t) { m[t] += v; }); } });
        return cnt ? m.map(function (v) { return v / cnt; }) : c;
      });
      if (!changed) break;
    }
    var wcss = P.reduce(function (s, p, i4) { return s + dist2(p, C[lab[i4]]); }, 0);
    return { lab: lab, C: C, wcss: wcss };
  }

  function kmeans(P, k) {
    var rng = mulberry32(2025 + k), best = null;
    for (var r = 0; r < KMEANS_RESTARTS; r++) {
      var f = kmeansOnce(P, k, rng);
      if (!best || f.wcss < best.wcss) best = f;
    }
    // Relabel by size: segment 1 is the largest.
    var sizes = best.C.map(function (_, j) { return best.lab.filter(function (l) { return l === j; }).length; });
    var order = sizes.map(function (_, j) { return j; }).sort(function (a, b) { return sizes[b] - sizes[a]; });
    var map = {}; order.forEach(function (j, r2) { map[j] = r2; });
    return {
      lab: best.lab.map(function (l) { return map[l]; }),
      C: order.map(function (j) { return best.C[j]; }),
      sizes: order.map(function (j) { return sizes[j]; }),
      wcss: best.wcss
    };
  }

  function clusterAll(res) {
    var P = res.people.map(function (p) { return p.pw; });
    res.wcss = []; res.fits = {};
    if (P.length < K_MAX + 2) return;
    var mean = P[0].map(function (_, t) { return P.reduce(function (s, p) { return s + p[t]; }, 0) / P.length; });
    res.wcss.push(P.reduce(function (s, p) { return s + dist2(p, mean); }, 0));
    for (var k = 2; k <= K_MAX; k++) {
      var f = kmeans(P, k);
      res.fits[k] = f;
      res.wcss.push(f.wcss);
    }
  }

  /* ---------- rendering ---------- */
  function setStatus(msg, isError) {
    document.querySelectorAll("[data-res-status]").forEach(function (s) {
      s.textContent = msg;
      s.classList.toggle("error", !!isError);
    });
  }

  function emptyNote(box) {
    box.innerHTML = "";
    box.appendChild(el("p", "res-empty", "No results loaded yet. Use “Load results file” on the “Our data” slide."));
  }

  function renderData(res) {
    document.querySelectorAll("[data-res-data]").forEach(function (sec) {
      var stats = sec.querySelector("[data-res-stats]");
      var tbl = sec.querySelector("[data-res-sample]");
      stats.innerHTML = ""; tbl.innerHTML = "";
      if (!res) return;
      [[res.nIds, "respondents"], [res.nObs, "ratings"], [res.perPerson, "trips rated per person"],
        [res.yMin + "–" + res.yMax, "rating scale"]].forEach(function (s) {
        var d = el("div", "stat");
        d.appendChild(el("span", "stat-value", String(s[0])));
        d.appendChild(el("span", "stat-label", s[1]));
        stats.appendChild(d);
      });
      var thead = el("thead"), tr = el("tr");
      ["Respondent"].concat(res.attrs.map(function (a) { return a.name; })).concat(["Rating"]).forEach(function (h) {
        tr.appendChild(el("th", null, h));
      });
      thead.appendChild(tr); tbl.appendChild(thead);
      var tb = el("tbody");
      res.sample.forEach(function (o) {
        var r = el("tr");
        r.appendChild(el("td", null, o.id));
        o.levels.forEach(function (l) { r.appendChild(el("td", null, l)); });
        r.appendChild(el("td", "key", String(o.y)));
        tb.appendChild(r);
      });
      tbl.appendChild(tb);
    });
  }

  function renderImportance(res) {
    document.querySelectorAll("[data-res-importance]").forEach(function (box) {
      if (!res) return emptyNote(box);
      box.innerHTML = "";
      var order = res.attrs.map(function (_, i) { return i; }).sort(function (a, b) { return res.meanImp[b] - res.meanImp[a]; });
      var max = Math.max.apply(null, res.meanImp);
      order.forEach(function (i) {
        var row = el("div", "imp-bar-row");
        row.title = res.attrs[i].name + ": " + pct(res.meanImp[i]) + " of the decision on average";
        row.appendChild(el("span", "imp-bar-name", res.attrs[i].name));
        var track = el("span", "imp-bar-track");
        var fill = el("span", "imp-bar-fill");
        fill.style.width = (res.meanImp[i] / max * 100).toFixed(1) + "%";
        track.appendChild(fill);
        row.appendChild(track);
        row.appendChild(el("span", "imp-bar-val", pct(res.meanImp[i])));
        box.appendChild(row);
      });
    });
  }

  function renderLevels(res) {
    document.querySelectorAll("[data-res-levels]").forEach(function (box) {
      if (!res) return emptyNote(box);
      box.innerHTML = "";
      var maxAbs = Math.max.apply(null, res.meanPw.map(Math.abs)) || 1;
      res.attrs.forEach(function (a, ai) {
        var panel = el("div", "pw-panel");
        panel.appendChild(el("h3", null, a.name));
        a.levels.forEach(function (l, li) {
          var v = res.meanPw[res.offsets[ai] + li];
          var row = el("div", "pw-row");
          row.title = l + ": " + fmt(v) + " rating points vs. the " + a.name.toLowerCase() + " average";
          row.appendChild(el("span", "pw-name", shortLabel(l)));
          var track = el("span", "pw-track");
          var bar = el("span", "pw-bar " + (v >= 0 ? "pos" : "neg"));
          var w = Math.abs(v) / maxAbs * 50;
          bar.style.width = w.toFixed(1) + "%";
          bar.style.left = (v >= 0 ? 50 : 50 - w).toFixed(1) + "%";
          track.appendChild(bar);
          row.appendChild(track);
          row.appendChild(el("span", "pw-num", fmt(v)));
          panel.appendChild(row);
        });
        box.appendChild(panel);
      });
    });
  }

  function lineChart(svgBox, values, opts) {
    var W = 420, H = 230, m = { l: 52, r: 14, t: 14, b: 40 };
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, class: "res-chart", role: "img", "aria-label": opts.label });
    var pts = values.map(function (v, i) { return { k: i + 1, v: v }; }).filter(function (p) { return p.v != null; });
    var vmin = opts.zero ? 0 : Math.min.apply(null, pts.map(function (p) { return p.v; }));
    var vmax = Math.max.apply(null, pts.map(function (p) { return p.v; }));
    var pad = (vmax - vmin) * 0.08 || 1;
    vmin = opts.zero ? 0 : vmin - pad; vmax += pad;
    function X(k) { return m.l + (k - 1) / (values.length - 1) * (W - m.l - m.r); }
    function Y(v) { return H - m.b - (v - vmin) / (vmax - vmin) * (H - m.t - m.b); }
    for (var g = 0; g <= 3; g++) {
      var gv = vmin + (vmax - vmin) * g / 3;
      svg.appendChild(svgEl("line", { x1: m.l, x2: W - m.r, y1: Y(gv), y2: Y(gv), class: "grid" }));
      var t = svgEl("text", { x: m.l - 8, y: Y(gv) + 4, class: "tick", "text-anchor": "end" });
      t.textContent = opts.fmt(gv); svg.appendChild(t);
    }
    values.forEach(function (_, i) {
      var t = svgEl("text", { x: X(i + 1), y: H - m.b + 18, class: "tick", "text-anchor": "middle" });
      t.textContent = String(i + 1); svg.appendChild(t);
    });
    var xl = svgEl("text", { x: (m.l + W - m.r) / 2, y: H - 4, class: "axis-label", "text-anchor": "middle" });
    xl.textContent = "Number of segments (k)"; svg.appendChild(xl);
    svg.appendChild(svgEl("polyline", {
      points: pts.map(function (p) { return X(p.k) + "," + Y(p.v); }).join(" "), class: "line"
    }));
    pts.forEach(function (p) {
      var c = svgEl("circle", { cx: X(p.k), cy: Y(p.v), r: p.k === opts.k ? 7 : 4.5, class: p.k === opts.k ? "dot on" : "dot" });
      var tt = svgEl("title", {}); tt.textContent = "k = " + p.k + ": " + opts.fmt(p.v);
      c.appendChild(tt); svg.appendChild(c);
    });
    svgBox.innerHTML = "";
    svgBox.appendChild(svg);
  }

  function renderK(res) {
    document.querySelectorAll("[data-res-k]").forEach(function (sec) {
      var elbow = sec.querySelector("[data-res-elbow]");
      var pick = sec.querySelector("[data-res-kpick]"), note = sec.querySelector("[data-res-knote]");
      if (!res || !res.wcss.length) { emptyNote(elbow); pick.innerHTML = ""; note.textContent = ""; return; }
      lineChart(elbow, res.wcss, { k: state.k, zero: false, label: "Elbow chart: within-segment sum of squares by number of segments", fmt: function (v) { return Math.round(v).toString(); } });
      pick.innerHTML = "";
      K_CHOICES.forEach(function (k) {
        var b = el("button", "k-btn" + (k === state.k ? " on" : ""), String(k));
        b.type = "button";
        b.setAttribute("aria-pressed", String(k === state.k));
        b.addEventListener("click", function () { state.k = k; renderK(res); renderSegments(res); renderSim(res); renderMarket(res); renderPodium(res); });
        pick.appendChild(b);
      });
      note.textContent = "No clear elbow, so we go with " + DEFAULT_K + " segments.";
    });
  }

  function renderSegments(res) {
    document.querySelectorAll("[data-res-segments]").forEach(function (box) {
      if (!res || !res.fits[state.k]) return emptyNote(box);
      box.innerHTML = "";
      var fit = res.fits[state.k], n = res.people.length;
      var maxAbs = 0;
      fit.C.forEach(function (c) { c.forEach(function (v) { maxAbs = Math.max(maxAbs, Math.abs(v)); }); });
      var groups = [[0, 1, 2], [3, 4]].map(function (g) { return g.filter(function (i) { return i < res.attrs.length; }); });
      if (res.attrs.length > 5) groups = [res.attrs.map(function (_, i) { return i; })];
      groups.forEach(function (g) {
        if (!g.length) return;
        var t = el("table", "data-table seg-table");
        var thead = el("thead"), hr = el("tr");
        hr.appendChild(el("th", "left", "Level"));
        fit.sizes.forEach(function (s, j) {
          var th = el("th");
          th.appendChild(el("span", "seg-name", "Segment " + (j + 1)));
          th.appendChild(el("span", "seg-size", s + " people · " + pct(s / n)));
          hr.appendChild(th);
        });
        thead.appendChild(hr); t.appendChild(thead);
        var tb = el("tbody");
        g.forEach(function (ai) {
          var a = res.attrs[ai];
          var gr = el("tr", "seg-group");
          var gtd = el("td", "left", a.name); gtd.colSpan = fit.sizes.length + 1;
          gr.appendChild(gtd); tb.appendChild(gr);
          a.levels.forEach(function (l, li) {
            var r = el("tr");
            r.appendChild(el("td", "left seg-level", shortLabel(l)));
            fit.C.forEach(function (c, j) {
              var vals = a.levels.map(function (_, x) { return c[res.offsets[ai] + x]; });
              var v = vals[li], best = Math.max.apply(null, vals) === v;
              var td = el("td", "seg-cell" + (best ? " best" : ""), fmt(v, 1));
              var share = Math.round(Math.min(1, Math.abs(v) / maxAbs) * 55);
              td.style.background = "color-mix(in srgb, " + (v >= 0 ? "var(--accent-2)" : "var(--accent)") + " " + share + "%, var(--bg))";
              td.title = "Segment " + (j + 1) + " · " + l + ": " + fmt(v) + " rating points" + (best ? " (favourite)" : "");
              r.appendChild(td);
            });
            tb.appendChild(r);
          });
        });
        t.appendChild(tb);
        box.appendChild(t);
      });
    });
  }

  /* Score simulator: pick one level per attribute, see the predicted rating overall and per segment. */
  function predicted(p, sel, res) {
    return sel.reduce(function (s, li, ai) { return s + p.pw[res.offsets[ai] + li]; }, p.base);
  }

  function renderSim(res) {
    document.querySelectorAll("[data-res-sim]").forEach(function (sec) {
      var pickBox = sec.querySelector("[data-sim-pick]"), out = sec.querySelector("[data-sim-out]");
      var segBox = sec.querySelector("[data-sim-segs]");
      if (!res || !res.people.length) { emptyNote(pickBox); out.textContent = "–"; segBox.innerHTML = ""; return; }
      if (!state.sim || state.sim.length !== res.attrs.length) state.sim = res.attrs.map(function () { return 0; });
      pickBox.innerHTML = "";
      res.attrs.forEach(function (a, ai) {
        var row = el("div", "sim-row");
        row.appendChild(el("span", "sim-attr", a.name));
        var lv = el("div", "sim-levels");
        a.levels.forEach(function (l, li) {
          var b = el("button", "sim-level" + (state.sim[ai] === li ? " on" : ""), shortLabel(l));
          b.type = "button";
          b.title = l;
          b.setAttribute("aria-pressed", String(state.sim[ai] === li));
          b.addEventListener("click", function () { state.sim[ai] = li; renderSim(res); });
          lv.appendChild(b);
        });
        row.appendChild(lv);
        pickBox.appendChild(row);
      });
      var all = res.people.map(function (p) { return predicted(p, state.sim, res); });
      var avg = all.reduce(function (s, v) { return s + v; }, 0) / all.length;
      out.textContent = avg.toFixed(2);
      segBox.innerHTML = "";
      var fit = res.fits[state.k];
      if (!fit) return;
      fit.sizes.forEach(function (size, j) {
        var vals = all.filter(function (_, i) { return fit.lab[i] === j; });
        var m = vals.reduce(function (s, v) { return s + v; }, 0) / (vals.length || 1);
        var d = el("div", "stat");
        d.appendChild(el("span", "stat-value", m.toFixed(2)));
        d.appendChild(el("span", "stat-label", "Segment " + (j + 1) + " · " + size + " people"));
        segBox.appendChild(d);
      });
    });
  }

  /* ---------- team bundles & market competition ---------- */
  /** Level indices of a team bundle in the current data, or null if a level is missing. */
  function teamSel(team, res) {
    var sel = res.attrs.map(function (a) { return a.levels.indexOf(team.levels[a.name]); });
    return sel.every(function (i) { return i >= 0; }) ? sel : null;
  }

  function bundleText(team, res) {
    return res.attrs.map(function (a) { return shortLabel(team.levels[a.name] || "?"); }).join(" · ");
  }

  function renderTeams(res) {
    document.querySelectorAll("[data-team-chips]").forEach(function (box) {
      box.innerHTML = "";
      if (!state.teams.length) { box.appendChild(el("span", "team-empty", "No team bundles yet.")); return; }
      state.teams.forEach(function (t, i) {
        var chip = el("span", "team-chip");
        chip.title = res ? bundleText(t, res) : "";
        chip.appendChild(el("b", null, t.name));
        var x = el("button", "team-del", "×");
        x.type = "button";
        x.setAttribute("aria-label", "Remove " + t.name);
        x.addEventListener("click", function () { state.teams.splice(i, 1); saveTeams(); renderTeams(state.result); renderMarket(state.result); renderPodium(state.result); });
        chip.appendChild(x);
        box.appendChild(chip);
      });
    });
  }

  function addTeam(input) {
    var res = state.result;
    if (!res || !state.sim) return;
    var name = (input.value || "").trim() || ("Team " + (state.teams.length + 1));
    var levels = {};
    res.attrs.forEach(function (a, ai) { levels[a.name] = a.levels[state.sim[ai]]; });
    var existing = state.teams.findIndex(function (t) { return t.name.toLowerCase() === name.toLowerCase(); });
    if (existing >= 0) state.teams[existing].levels = levels;   // same name: update that team's bundle
    else state.teams.push({ name: name, levels: levels });
    input.value = "";
    saveTeams();
    renderTeams(res);
    renderMarket(res);
    renderPodium(res);
  }

  /**
   * Market shares of the team bundles, computed person by person with the chosen rule:
   *  - first: each person picks the bundle with their highest predicted rating
   *  - sop:   share of preference, each person splits in proportion to their predicted ratings
   *           (ratings below 0 count as 0; if all are 0 the person splits equally)
   *  - logit: each person splits in proportion to exp(beta * predicted rating)
   * Identical bundles are one option: whatever that option gets is split equally between the teams offering it.
   */
  function choiceProbs(r, rule, beta) {
    if (rule === "first") {
      var mx = Math.max.apply(null, r);
      var win = r.map(function (v) { return v >= mx - 1e-9 ? 1 : 0; });
      var nw = win.reduce(function (a, b) { return a + b; }, 0);
      return win.map(function (w) { return w / nw; });
    }
    if (rule === "sop") {
      var pos = r.map(function (v) { return Math.max(0, v); });
      var tot = pos.reduce(function (a, b) { return a + b; }, 0);
      return pos.map(function (v) { return tot > 0 ? v / tot : 1 / r.length; });
    }
    var m = Math.max.apply(null, r);
    var ex = r.map(function (v) { return Math.exp(beta * (v - m)); });
    var z = ex.reduce(function (a, b) { return a + b; }, 0);
    return ex.map(function (e) { return e / z; });
  }

  function marketShares(res, teams) {
    var fit = res.fits[state.k];
    var nSeg = fit ? fit.sizes.length : 0;
    // Group identical bundles into one option.
    var keys = [], optOf = teams.map(function (t) {
      var key = t.sel.join(",");
      var o = keys.indexOf(key);
      if (o < 0) { keys.push(key); o = keys.length - 1; }
      return o;
    });
    var nTeamsOf = keys.map(function (_, o) { return optOf.filter(function (x) { return x === o; }).length; });
    var optSel = keys.map(function (k) { return k.split(",").map(Number); });
    var share = teams.map(function () { return { all: 0, seg: new Array(nSeg).fill(0) }; });
    var rating = teams.map(function () { return 0; });
    res.people.forEach(function (p, i) {
      var r = optSel.map(function (sel) { return predicted(p, sel, res); });
      var pr = choiceProbs(r, state.rule, state.beta);
      teams.forEach(function (_, t) {
        var o = optOf[t], v = pr[o] / nTeamsOf[o];
        rating[t] += r[o] / res.people.length;
        share[t].all += v;
        if (fit) share[t].seg[fit.lab[i]] += v;
      });
    });
    return share.map(function (s, t) {
      return {
        all: s.all / res.people.length,
        seg: s.seg.map(function (v, j) { return v / fit.sizes[j]; }),
        rating: rating[t]
      };
    });
  }

  var RULE_NOTES = {
    first: "First choice: each person picks the team bundle with their <strong>highest predicted rating</strong>.",
    sop: "Share of preference: each person splits their choice <strong>in proportion to their predicted ratings</strong>.",
    logit: "Logit: each person splits their choice in proportion to <strong>e<sup>β × predicted rating</sup></strong>. Small β → close to equal shares; large β → close to first choice."
  };

  function renderRuleControls() {
    document.querySelectorAll("[data-market-rule]").forEach(function (b) {
      var on = b.getAttribute("data-market-rule") === state.rule;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    });
    document.querySelectorAll("[data-market-beta-wrap]").forEach(function (w) { w.hidden = state.rule !== "logit"; });
    document.querySelectorAll("[data-market-beta-out]").forEach(function (o) { o.textContent = state.beta.toFixed(1); });
    document.querySelectorAll("[data-market-note]").forEach(function (n) {
      n.innerHTML = RULE_NOTES[state.rule] + " If several teams offer the same bundle, what that bundle gets is split equally between them.";
    });
  }

  function renderMarket(res) {
    document.querySelectorAll("[data-market-box]").forEach(function (box) {
      if (!res) return emptyNote(box);
      box.innerHTML = "";
      var teams = state.teams.map(function (t) { return { name: t.name, src: t, sel: teamSel(t, res) }; });
      var bad = teams.filter(function (t) { return !t.sel; });
      teams = teams.filter(function (t) { return t.sel; });
      if (!teams.length) {
        box.appendChild(el("p", "res-empty", "Add team bundles on the score simulator slide, then come back here."));
        return;
      }
      var sh = marketShares(res, teams);
      var order = teams.map(function (_, i) { return i; }).sort(function (a, b) { return sh[b].all - sh[a].all; });
      var top = sh[order[0]].all;
      var distinct = [];
      order.forEach(function (i) {
        if (!distinct.some(function (v) { return Math.abs(v - sh[i].all) < 1e-9; })) distinct.push(sh[i].all);
      });
      var fit = res.fits[state.k];
      var tbl = el("table", "data-table market-table");
      var thead = el("thead"), hr = el("tr");
      hr.appendChild(el("th", "left", "Team"));
      hr.appendChild(el("th", "left", "Bundle"));
      hr.appendChild(el("th", null, "Avg. rating"));
      if (fit) fit.sizes.forEach(function (_, j) { hr.appendChild(el("th", null, "Seg. " + (j + 1))); });
      hr.appendChild(el("th", "left share-col", "Market share"));
      thead.appendChild(hr); tbl.appendChild(thead);
      var tb = el("tbody");
      order.forEach(function (i) {
        var t = teams[i], s = sh[i], win = s.all >= top - 1e-9 && top > 0;
        // Medal = place among the distinct market shares (same ranking as the podium; ties share a medal).
        var place = distinct.findIndex(function (v) { return Math.abs(v - s.all) < 1e-9; });
        var medal = s.all > 0 && place >= 0 && place < 3 ? ["🥇", "🥈", "🥉"][place] + " " : "";
        var r = el("tr", win ? "winner" : "");
        r.appendChild(el("td", "left team-name", medal + t.name));
        r.appendChild(el("td", "left bundle", bundleText(t.src, res)));
        r.appendChild(el("td", null, s.rating.toFixed(2)));
        if (fit) s.seg.forEach(function (v) { r.appendChild(el("td", null, pct(v))); });
        var td = el("td", "left share-col");
        var track = el("span", "share-track"), fill = el("span", "share-fill");
        fill.style.width = (s.all * 100).toFixed(1) + "%";
        track.appendChild(fill);
        td.appendChild(track);
        td.appendChild(el("span", "share-val", (s.all * 100).toFixed(1) + "%"));
        r.appendChild(td);
        tb.appendChild(r);
      });
      tbl.appendChild(tb);
      box.appendChild(tbl);
      if (bad.length) {
        box.appendChild(el("p", "res-warn", "Not in this data (a level is missing): " + bad.map(function (t) { return t.name; }).join(", ")));
      }
    });
  }

  /* Podium: gold / silver / bronze by market share under the selected choice rule; ties share a step. */
  var RULE_NAMES = { first: "first choice", sop: "share of preference", logit: "logit" };
  function renderPodium(res) {
    document.querySelectorAll("[data-res-podium]").forEach(function (sec) {
      var note = sec.querySelector("[data-pod-note]");
      [1, 2, 3].forEach(function (p) {
        sec.querySelector('[data-pod-name="' + p + '"]').textContent = "—";
        sec.querySelector('[data-pod-share="' + p + '"]').textContent = "";
      });
      if (!res) { note.textContent = "Load the results first."; return; }
      var teams = state.teams.map(function (t) { return { name: t.name, sel: teamSel(t, res) }; }).filter(function (t) { return t.sel; });
      if (!teams.length) { note.textContent = "Add team bundles on the score simulator slide."; return; }
      var sh = marketShares(res, teams);
      var vals = [];
      sh.forEach(function (s) { if (!vals.some(function (v) { return Math.abs(v - s.all) < 1e-9; })) vals.push(s.all); });
      vals.sort(function (a, b) { return b - a; });
      vals.slice(0, 3).forEach(function (v, p) {
        var names = teams.filter(function (_, i) { return Math.abs(sh[i].all - v) < 1e-9; }).map(function (t) { return t.name; });
        sec.querySelector('[data-pod-name="' + (p + 1) + '"]').textContent = names.join(" & ");
        sec.querySelector('[data-pod-share="' + (p + 1) + '"]').textContent = (v * 100).toFixed(1) + "% market share" + (names.length > 1 ? " each" : "");
      });
      note.textContent = "Market shares with the " + RULE_NAMES[state.rule] + " rule (change it on the next slide).";
    });
  }

  function renderAll() {
    var res = state.result;
    if (res && (state.k == null || !res.fits[state.k])) state.k = DEFAULT_K;
    renderData(res); renderImportance(res); renderLevels(res); renderK(res); renderSegments(res); renderSim(res);
    renderTeams(res); renderMarket(res); renderPodium(res);
  }

  function useTable(table, source) {
    try {
      var ds = toDataset(table);
      if (!ds.obs.length || !ds.attrs.length) throw new Error("no usable rows");
      state.result = analyze(ds);
      state.k = null;
      state.sim = null;
      var r = state.result;
      setStatus("Loaded " + source + ": " + r.nIds + " respondents, " +
        r.people.length + " analyzed" +
        (r.skipped ? " (" + r.skipped + " skipped: too few ratings)" : "") + ".");
      renderAll();
    } catch (e) {
      setStatus("Could not read " + source + " (" + e.message + "). Expected columns: Respondent, attributes…, Rating.", true);
    }
  }

  /* ---------- loading ---------- */
  var xlsxPromise = null;
  function loadXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!xlsxPromise) {
      xlsxPromise = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = "../vendor/sheetjs-0.18.5/xlsx.full.min.js";   // local copy: works offline
        s.onload = function () { resolve(window.XLSX); };
        s.onerror = function () { reject(new Error("could not load the Excel reader")); };
        document.head.appendChild(s);
      });
    }
    return xlsxPromise;
  }

  function readFile(file) {
    var name = file.name;
    if (/\.(xlsx|xls|xlsm)$/i.test(name)) {
      setStatus("Reading " + name + "…");
      Promise.all([loadXLSX(), file.arrayBuffer()]).then(function (r) {
        var wb = r[0].read(r[1], { type: "array" });
        var sheet = wb.Sheets[wb.SheetNames[0]];
        useTable(r[0].utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" }), name);
      }).catch(function (e) { setStatus("Could not read " + name + " (" + e.message + ").", true); });
    } else {
      file.text().then(function (t) { useTable(parseCSV(t), name); });
    }
  }

  /* ---------- winner announcement effects (podium slide) ---------- */
  var fx = { canvas: null, parts: [], raf: 0 };
  var REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var CONFETTI = {
    gold: ["#f5c542", "#e3b341", "#fff1b8", "#0f766e", "#b45309", "#ffffff"],
    silver: ["#d7dde3", "#b9c0c8", "#ffffff", "#8a939c"],
    bronze: ["#d08b52", "#e8b48a", "#a0602f", "#ffffff"]
  };

  function fxCanvas() {
    if (!fx.canvas) {
      fx.canvas = document.createElement("canvas");
      fx.canvas.className = "podium-confetti";
      fx.canvas.setAttribute("aria-hidden", "true");
      document.body.appendChild(fx.canvas);
    }
    var dpr = window.devicePixelRatio || 1;
    fx.canvas.width = innerWidth * dpr;
    fx.canvas.height = innerHeight * dpr;
    return fx.canvas;
  }

  /** Burst of confetti from (x, y) in viewport pixels. */
  function burst(x, y, n, colors, power, spread) {
    for (var i = 0; i < n; i++) {
      var a = -Math.PI / 2 + (Math.random() - 0.5) * spread;
      var v = power * (0.45 + Math.random() * 0.75);
      fx.parts.push({
        x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        w: 6 + Math.random() * 7, h: 4 + Math.random() * 6,
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.35,
        color: colors[Math.floor(Math.random() * colors.length)],
        life: 0, max: 150 + Math.random() * 90
      });
    }
    if (!fx.raf) fx.raf = requestAnimationFrame(step);
  }

  function step() {
    var c = fx.canvas, ctx = c.getContext("2d"), dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, c.width, c.height);
    fx.parts = fx.parts.filter(function (p) { return p.life < p.max && p.y < innerHeight + 40; });
    fx.parts.forEach(function (p) {
      p.life++; p.vy += 0.18; p.vx *= 0.99; p.vy *= 0.99;
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - p.life / p.max);
      ctx.translate(p.x * dpr, p.y * dpr);
      ctx.rotate(p.rot);
      ctx.scale(1, Math.cos(p.life * 0.15));      // flutter
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w * dpr / 2, -p.h * dpr / 2, p.w * dpr, p.h * dpr);
      ctx.restore();
    });
    fx.raf = fx.parts.length ? requestAnimationFrame(step) : 0;
    if (!fx.raf) ctx.clearRect(0, 0, c.width, c.height);
  }

  function stopFx() {
    fx.parts = [];
    if (fx.raf) cancelAnimationFrame(fx.raf);
    fx.raf = 0;
    if (fx.canvas) fx.canvas.getContext("2d").clearRect(0, 0, fx.canvas.width, fx.canvas.height);
  }

  function announce(col) {
    col.classList.remove("lit");
    void col.offsetWidth;                        // restart the CSS animations
    col.classList.add("lit");
    if (REDUCED) return;
    var place = col.classList.contains("gold") ? "gold" : col.classList.contains("silver") ? "silver" : "bronze";
    fxCanvas();
    var r = col.querySelector(".pod-step").getBoundingClientRect();
    var cx = r.left + r.width / 2;
    if (place === "gold") {
      burst(cx, r.top, 160, CONFETTI.gold, 16, 1.6);
      setTimeout(function () { burst(innerWidth * 0.08, innerHeight, 90, CONFETTI.gold, 20, 0.7); }, 250);
      setTimeout(function () { burst(innerWidth * 0.92, innerHeight, 90, CONFETTI.gold, 20, 0.7); }, 450);
      setTimeout(function () { burst(cx, r.top, 80, CONFETTI.gold, 14, 2.2); }, 900);
    } else {
      burst(cx, r.top, place === "silver" ? 70 : 50, CONFETTI[place], 10, 1.4);
    }
  }

  function initPodiumFx() {
    if (!window.Reveal || !Reveal.on) return;
    Reveal.on("fragmentshown", function (e) {
      var col = e.fragment && e.fragment.closest && e.fragment.closest("[data-res-podium] .pod-col");
      if (col) announce(col);
    });
    Reveal.on("fragmenthidden", function (e) {
      var col = e.fragment && e.fragment.closest && e.fragment.closest("[data-res-podium] .pod-col");
      if (col) col.classList.remove("lit");
    });
    Reveal.on("slidechanged", function (e) {
      stopFx();
      document.querySelectorAll("[data-res-podium] .pod-col").forEach(function (col) {
        // Arriving with fragments already shown (e.g. going back): keep the glow, skip the confetti.
        col.classList.toggle("lit", !!col.querySelector(".pod-team.visible") && e.currentSlide.hasAttribute("data-res-podium"));
      });
    });
  }

  window.startResultsAnalysis = function () {
    initPodiumFx();
    loadTeams();
    document.querySelectorAll("[data-market-rule]").forEach(function (b) {
      b.addEventListener("click", function () {
        state.rule = b.getAttribute("data-market-rule");
        renderRuleControls(); renderMarket(state.result); renderPodium(state.result);
      });
    });
    document.querySelectorAll("[data-market-beta]").forEach(function (sl) {
      sl.addEventListener("input", function () {
        var v = parseFloat(sl.value);
        state.beta = isFinite(v) ? v : 1;
        renderRuleControls(); renderMarket(state.result); renderPodium(state.result);
      });
    });
    renderRuleControls();
    document.querySelectorAll("[data-res-sim]").forEach(function (sec) {
      var input = sec.querySelector("[data-team-name]");
      sec.querySelector("[data-team-add]").addEventListener("click", function () { addTeam(input); });
      input.addEventListener("keydown", function (e) {
        e.stopPropagation();   // typing a name must not move the slides
        if (e.key === "Enter") addTeam(input);
      });
    });
    document.querySelectorAll("[data-team-reset]").forEach(function (b) {
      b.addEventListener("click", function () {
        if (!state.teams.length || !window.confirm("Remove all team bundles?")) return;
        state.teams = []; saveTeams(); renderTeams(state.result); renderMarket(state.result); renderPodium(state.result);
      });
    });
    document.querySelectorAll("[data-res-file]").forEach(function (input) {
      input.addEventListener("change", function () { if (input.files[0]) readFile(input.files[0]); });
    });
    renderAll();
    fetch(DATA_URL).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.text();
    }).then(function (t) {
      useTable(parseCSV(t), "Dream Destination data.csv");
    }).catch(function () {
      setStatus("Load the results file (CSV or Excel) with the button above.");
    });
  };
})();
