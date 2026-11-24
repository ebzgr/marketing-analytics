/**
 * WTP poll UI + Chart.js demand curve + multiplicative elasticity fit for Reveal.js
 *
 * Classroom live Google Forms sync is intentionally NOT in this repo
 * (no OAuth, no API credentials, no Forms response reader).
 * Plots use the built-in demo seed unless a same-origin /api/wtp is provided
 * by a private local tool the instructor runs separately.
 */
(function () {
  const DEFAULTS = {
    formUrl: "",
    responsesApiUrl: "",
    currency: "€",
    autoRefreshMs: 5000,
    demoSeed: [420, 350, 280, 250, 220, 200, 180, 150, 120, 100, 90, 80, 60, 50, 40, 30, 25, 20, 15, 10]
  };

  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function qrUrl(formUrl, size) {
    return (
      "https://api.qrserver.com/v1/create-qr-code/?size=" +
      size +
      "x" +
      size +
      "&margin=8&data=" +
      encodeURIComponent(formUrl)
    );
  }

  async function fetchWtps(apiUrl) {
    // No API configured → demo seed only (safe for public GitHub Pages)
    if (!apiUrl) return { wtps: DEFAULTS.demoSeed.slice(), source: "demo" };
    const url = apiUrl + (apiUrl.includes("?") ? "&" : "?") + "_ts=" + Date.now();
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 404) return { wtps: DEFAULTS.demoSeed.slice(), source: "demo-no-proxy" };
        throw new Error("HTTP " + res.status);
      }
      const data = await res.json();
      if (!data || data.ok === false) throw new Error((data && data.error) || "API error");
      const wtps = Array.isArray(data.wtps) ? data.wtps.filter((n) => Number.isFinite(n) && n > 0) : [];
      return { wtps, source: wtps.length ? "live-api" : "live-empty" };
    } catch (err) {
      if (String(err.message || "").includes("Unexpected token")) {
        return { wtps: DEFAULTS.demoSeed.slice(), source: "demo-no-proxy" };
      }
      throw err;
    }
  }

  function stepSeries(wtps) {
    const sorted = wtps.slice().sort((a, b) => b - a);
    // Build explicit step vertices so Chart.js tooltips sit on the curve
    const points = [];
    sorted.forEach((price, i) => {
      const q0 = i;
      const q1 = i + 1;
      if (i === 0) points.push({ x: 0, y: price });
      points.push({ x: q1, y: price });
      if (i < sorted.length - 1) points.push({ x: q1, y: sorted[i + 1] });
    });
    return { sorted, points };
  }

  function buyersAtPrice(sortedDesc, price) {
    let q = 0;
    for (let i = 0; i < sortedDesc.length; i++) {
      if (sortedDesc[i] >= price) q += 1;
      else break;
    }
    return q;
  }

  function setCounts(n) {
    document.querySelectorAll("[data-wtp-count]").forEach(function (el) {
      el.textContent = String(n);
    });
  }

  function mountQrSlide(root) {
    const formUrl = root.dataset.formUrl || DEFAULTS.formUrl;
    const qrImg = root.querySelector("[data-wtp-qr]");
    if (qrImg && formUrl) {
      qrImg.src = qrUrl(formUrl, 640);
      qrImg.hidden = false;
    }
  }

  function mountCounter(root) {
    const apiUrl = root.dataset.responsesApi || DEFAULTS.responsesApiUrl;
    const clearApiUrl = root.dataset.clearApi || "";
    const eraseBtn = root.querySelector("[data-wtp-erase]");
    let timer = null;
    let busy = false;

    async function refreshCount() {
      if (busy) return;
      busy = true;
      try {
        const result = await fetchWtps(apiUrl);
        // Demo fallback means proxy isn't running — show 0, not fake seed
        const count =
          result.source === "demo" || result.source === "demo-no-proxy" ? 0 : result.wtps.length;
        setCounts(count);
      } catch (_) {
        /* keep last */
      } finally {
        busy = false;
      }
    }

    async function eraseResponses() {
      if (!clearApiUrl) {
        window.alert("Response erase is not available in the published slides.");
        return;
      }
      const ok = window.confirm("Erase all responses from the live plot? (Starts a fresh count for class.)");
      if (!ok) return;
      try {
        const res = await fetch(clearApiUrl, { method: "POST", cache: "no-store" });
        const data = await res.json().catch(function () {
          return null;
        });
        if (!res.ok || !data || data.ok === false) {
          throw new Error((data && data.error) || "Clear failed (" + res.status + ")");
        }
        setCounts(0);
        await refreshCount();
      } catch (err) {
        window.alert("Erase failed: " + (err.message || err));
      }
    }

    function start() {
      refreshCount();
      stop();
      timer = window.setInterval(refreshCount, DEFAULTS.autoRefreshMs);
    }

    function stop() {
      if (timer) {
        window.clearInterval(timer);
        timer = null;
      }
    }

    if (eraseBtn) {
      eraseBtn.addEventListener("click", function (e) {
        e.preventDefault();
        eraseResponses();
      });
    }

    root._wtpCounter = { start, stop, refresh: refreshCount };
    return root._wtpCounter;
  }

  function mountChart(root) {
    if (typeof Chart === "undefined") {
      console.error("Chart.js failed to load");
      return null;
    }

    const cfg = {
      responsesApiUrl: root.dataset.responsesApi || DEFAULTS.responsesApiUrl,
      currency: root.dataset.currency || DEFAULTS.currency
    };

    const canvas = root.querySelector("canvas[data-wtp-canvas]");
    const refreshBtn = root.querySelector("[data-wtp-refresh]");
    if (!canvas) return null;

    const ink = cssVar("--ink", "#1a1f24");
    const muted = cssVar("--muted", "#5a6570");
    const accent = cssVar("--accent-2", "#0f766e");
    const line = cssVar("--line", "rgba(26,31,36,0.12)");

    let chart = null;
    let sortedCache = [];
    let timer = null;
    let busy = false;

    function ensureChart() {
      if (chart) return chart;
      chart = new Chart(canvas.getContext("2d"), {
        type: "line",
        data: {
          datasets: [
            {
              label: "Demand",
              data: [],
              parsing: false,
              borderColor: accent,
              backgroundColor: accent,
              borderWidth: 2.5,
              pointRadius: 3.5,
              pointHoverRadius: 6,
              pointBackgroundColor: accent,
              pointBorderColor: "#fff",
              pointBorderWidth: 1.5,
              tension: 0,
              stepped: false,
              spanGaps: false
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 250 },
          interaction: {
            mode: "nearest",
            intersect: false,
            axis: "x"
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              enabled: true,
              displayColors: false,
              backgroundColor: "rgba(255,255,255,0.96)",
              titleColor: ink,
              bodyColor: ink,
              borderColor: line,
              borderWidth: 1,
              padding: 10,
              caretPadding: 8,
              cornerRadius: 8,
              titleFont: { weight: "700", size: 13 },
              bodyFont: { weight: "600", size: 12 },
              callbacks: {
                title: function (items) {
                  if (!items.length) return "";
                  const price = items[0].parsed.y;
                  return "At " + cfg.currency + Math.round(price);
                },
                label: function (item) {
                  const price = item.parsed.y;
                  const q = buyersAtPrice(sortedCache, price);
                  return q + " student" + (q === 1 ? "" : "s") + " would buy";
                }
              }
            }
          },
          scales: {
            x: {
              type: "linear",
              title: {
                display: true,
                text: "Quantity (students with WTP ≥ P)",
                color: muted,
                font: { weight: "700", size: 12 }
              },
              ticks: { color: muted, precision: 0 },
              grid: { color: line },
              border: { color: ink },
              min: 0
            },
            y: {
              title: {
                display: true,
                text: "Price / WTP (" + cfg.currency + ")",
                color: muted,
                font: { weight: "700", size: 12 }
              },
              ticks: { color: muted },
              grid: { color: line },
              border: { color: ink },
              beginAtZero: true
            }
          }
        }
      });
      return chart;
    }

    function render(wtps) {
      const c = ensureChart();
      if (!wtps.length) {
        sortedCache = [];
        c.data.datasets[0].data = [];
        c.options.plugins.tooltip.enabled = false;
        c.update("none");
        return;
      }
      const { sorted, points } = stepSeries(wtps);
      sortedCache = sorted;
      c.data.datasets[0].data = points;
      c.options.plugins.tooltip.enabled = true;
      c.options.scales.x.max = Math.max(sorted.length, 1) * 1.05;
      c.options.scales.y.suggestedMax = sorted[0] * 1.08;
      c.update();
    }

    async function refresh() {
      if (busy) return;
      busy = true;
      try {
        const { wtps, source } = await fetchWtps(cfg.responsesApiUrl);
        // Demo seed only if proxy missing — empty live stays empty
        const use = source === "demo" || source === "demo-no-proxy" ? wtps : wtps;
        render(use);
        setCounts(use.length);
      } catch (err) {
        console.warn("WTP refresh failed:", err);
        render(DEFAULTS.demoSeed.slice());
      } finally {
        busy = false;
      }
    }

    function start() {
      refresh();
      stop();
      timer = window.setInterval(refresh, DEFAULTS.autoRefreshMs);
      // Reveal often resizes after slide change — resize chart next frame
      window.requestAnimationFrame(function () {
        if (chart) chart.resize();
      });
    }

    function stop() {
      if (timer) {
        window.clearInterval(timer);
        timer = null;
      }
    }

    if (refreshBtn) {
      refreshBtn.addEventListener("click", function (e) {
        e.preventDefault();
        refresh();
      });
    }

    root._wtpLive = { start, stop, refresh };
    return root._wtpLive;
  }

  /** Demand observations: at each unique WTP price p, Q = # students with WTP ≥ p */
  function demandObservations(wtps) {
    const prices = Array.from(new Set(wtps.filter(function (p) {
      return Number.isFinite(p) && p > 0;
    }))).sort(function (a, b) {
      return a - b;
    });
    return prices
      .map(function (p) {
        var q = 0;
        for (var i = 0; i < wtps.length; i++) {
          if (wtps[i] >= p) q += 1;
        }
        return { p: p, q: q };
      })
      .filter(function (d) {
        return d.q > 0 && d.p > 0;
      });
  }

  /** Drop crazy-high WTP: remove the top `dropN` values */
  function dropOutlierWtps(wtps, dropN) {
    dropN = Math.max(0, Math.floor(Number(dropN) || 0));
    if (!wtps.length) return { kept: [], cutoff: null, dropped: 0 };
    dropN = Math.min(dropN, Math.max(0, wtps.length - 3)); // keep ≥3 for regression
    if (dropN === 0) return { kept: wtps.slice(), cutoff: null, dropped: 0 };
    var sortedAsc = wtps.slice().sort(function (a, b) {
      return a - b;
    });
    var cutoff = sortedAsc[sortedAsc.length - dropN];
    var sortedDesc = wtps.slice().sort(function (a, b) {
      return b - a;
    });
    var dropSet = sortedDesc.slice(0, dropN);
    var dropCounts = {};
    dropSet.forEach(function (p) {
      dropCounts[p] = (dropCounts[p] || 0) + 1;
    });
    var kept = [];
    wtps.forEach(function (p) {
      if (dropCounts[p] > 0) {
        dropCounts[p] -= 1;
      } else {
        kept.push(p);
      }
    });
    return { kept: kept, cutoff: cutoff, dropped: dropN };
  }

  /** OLS: log Q = a + b log P  →  E_p = b,  η = −b */
  function fitMultiplicative(obs) {
    var n = obs.length;
    if (n < 3) return null;
    var sx = 0;
    var sy = 0;
    var sxx = 0;
    var sxy = 0;
    for (var i = 0; i < n; i++) {
      var x = Math.log(obs[i].p);
      var y = Math.log(obs[i].q);
      sx += x;
      sy += y;
      sxx += x * x;
      sxy += x * y;
    }
    var den = n * sxx - sx * sx;
    if (!Number.isFinite(den) || Math.abs(den) < 1e-12) return null;
    var b = (n * sxy - sx * sy) / den;
    var a = (sy - b * sx) / n;
    return { a: a, b: b, eta: -b, n: n };
  }

  function fittedCurve(fit, pMin, pMax, steps) {
    if (!fit) return [];
    var out = [];
    var lo = Math.log(Math.max(pMin, 1e-6));
    var hi = Math.log(Math.max(pMax, pMin * 1.01));
    for (var i = 0; i <= steps; i++) {
      var p = Math.exp(lo + ((hi - lo) * i) / steps);
      var q = Math.exp(fit.a + fit.b * Math.log(p));
      if (Number.isFinite(q) && q > 0) out.push({ x: q, y: p });
    }
    return out;
  }

  function formatEta(eta) {
    if (!Number.isFinite(eta)) return "—";
    return eta.toFixed(2);
  }

  function mountElasticity(root) {
    if (typeof Chart === "undefined") {
      console.error("Chart.js failed to load");
      return null;
    }

    var apiUrl = root.dataset.responsesApi || DEFAULTS.responsesApiUrl;
    var currency = root.dataset.currency || DEFAULTS.currency;
    var refreshBtn = root.querySelector("[data-wtp-elasticity-refresh]");
    var outlierInput = root.querySelector("[data-wtp-outlier-count]");
    var noteEl = root.querySelector("[data-wtp-elasticity-note]");
    var panels = [
      {
        key: "all",
        canvas: root.querySelector("canvas[data-wtp-elasticity-all]"),
        etaEl: root.querySelector("[data-wtp-eta-all]"),
        epEl: root.querySelector("[data-wtp-ep-all]"),
        nEl: root.querySelector("[data-wtp-n-all]")
      },
      {
        key: "trim",
        canvas: root.querySelector("canvas[data-wtp-elasticity-trim]"),
        etaEl: root.querySelector("[data-wtp-eta-trim]"),
        epEl: root.querySelector("[data-wtp-ep-trim]"),
        nEl: root.querySelector("[data-wtp-n-trim]")
      }
    ];

    var ink = cssVar("--ink", "#1a1f24");
    var muted = cssVar("--muted", "#5a6570");
    var accent = cssVar("--accent-2", "#0f766e");
    var accentSoft = "color-mix(in srgb, " + accent + " 55%, #94a3b8)";
    var line = cssVar("--line", "rgba(26,31,36,0.12)");
    var charts = { all: null, trim: null };
    var busy = false;
    var timer = null;

    function makeChart(canvas) {
      return new Chart(canvas.getContext("2d"), {
        type: "scatter",
        data: {
          datasets: [
            {
              label: "Observed demand",
              data: [],
              parsing: false,
              showLine: false,
              pointRadius: 4,
              pointHoverRadius: 6,
              backgroundColor: accent,
              borderColor: "#fff",
              borderWidth: 1.25,
              order: 2
            },
            {
              label: "Fitted Q = A P^(−η)",
              data: [],
              parsing: false,
              showLine: true,
              pointRadius: 0,
              borderColor: accentSoft,
              borderWidth: 2.25,
              borderDash: [5, 4],
              tension: 0.15,
              order: 1
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 220 },
          plugins: {
            legend: {
              display: true,
              position: "bottom",
              labels: {
                color: muted,
                boxWidth: 10,
                font: { size: 10, weight: "600" },
                padding: 8
              }
            },
            tooltip: {
              enabled: true,
              displayColors: false,
              backgroundColor: "rgba(255,255,255,0.96)",
              titleColor: ink,
              bodyColor: ink,
              borderColor: line,
              borderWidth: 1,
              callbacks: {
                title: function (items) {
                  if (!items.length) return "";
                  return currency + Math.round(items[0].parsed.y);
                },
                label: function (item) {
                  return "Q ≈ " + Math.round(item.parsed.x * 10) / 10;
                }
              }
            }
          },
          scales: {
            x: {
              type: "linear",
              title: {
                display: true,
                text: "Quantity Q",
                color: muted,
                font: { weight: "700", size: 11 }
              },
              ticks: { color: muted, precision: 0 },
              grid: { color: line },
              border: { color: ink },
              min: 0
            },
            y: {
              type: "linear",
              title: {
                display: true,
                text: "Price P (" + currency + ")",
                color: muted,
                font: { weight: "700", size: 11 }
              },
              ticks: { color: muted },
              grid: { color: line },
              border: { color: ink },
              beginAtZero: true
            }
          }
        }
      });
    }

    function setPanelStats(panel, fit, nPeople) {
      if (panel.etaEl) {
        panel.etaEl.textContent = fit ? formatEta(fit.eta) : "—";
      }
      if (panel.epEl) {
        panel.epEl.textContent = fit ? fit.b.toFixed(2) : "—";
      }
      if (panel.nEl) {
        panel.nEl.textContent = String(nPeople);
      }
    }

    function renderPanel(panel, wtps) {
      if (!panel.canvas) return;
      if (!charts[panel.key]) charts[panel.key] = makeChart(panel.canvas);
      var chart = charts[panel.key];
      var obs = demandObservations(wtps);
      var fit = fitMultiplicative(obs);
      setPanelStats(panel, fit, wtps.length);

      var scatter = obs.map(function (d) {
        return { x: d.q, y: d.p };
      });
      chart.data.datasets[0].data = scatter;

      if (fit && obs.length) {
        var pMin = obs[0].p;
        var pMax = obs[obs.length - 1].p;
        chart.data.datasets[1].data = fittedCurve(fit, pMin, pMax, 60);
      } else {
        chart.data.datasets[1].data = [];
      }

      var maxQ = 1;
      var maxP = 1;
      scatter.forEach(function (pt) {
        if (pt.x > maxQ) maxQ = pt.x;
        if (pt.y > maxP) maxP = pt.y;
      });
      chart.options.scales.x.max = maxQ * 1.08;
      chart.options.scales.y.suggestedMax = maxP * 1.1;
      chart.update();
    }

    async function refresh() {
      if (busy) return;
      busy = true;
      try {
        var result = await fetchWtps(apiUrl);
        var wtps =
          result.source === "demo" || result.source === "demo-no-proxy"
            ? result.wtps
            : result.wtps;
        if (!wtps.length) {
          panels.forEach(function (panel) {
            renderPanel(panel, []);
          });
          if (noteEl) noteEl.textContent = "No responses yet — run the live poll first.";
          return;
        }
        var dropN = outlierInput ? Number(outlierInput.value) : 3;
        if (!Number.isFinite(dropN) || dropN < 0) dropN = 0;
        var trim = dropOutlierWtps(wtps, dropN);
        renderPanel(panels[0], wtps);
        renderPanel(panels[1], trim.kept);
        if (noteEl) {
          if (trim.dropped === 0) {
            noteEl.textContent =
              "No outliers dropped. Regression: log Q = α − η log P on the demand curve from class WTP.";
          } else {
            noteEl.textContent =
              "Outliers = top " +
              trim.dropped +
              " highest WTP value" +
              (trim.dropped === 1 ? "" : "s") +
              " (from " +
              currency +
              Math.round(trim.cutoff) +
              "). Right panel updates when you change the count and click Refresh. Regression: log Q = α − η log P.";
          }
        }
      } catch (err) {
        console.warn("Elasticity refresh failed:", err);
        if (noteEl) noteEl.textContent = "Could not load WTP data. Is the live server running?";
      } finally {
        busy = false;
      }
    }

    function start() {
      refresh();
      stop();
      timer = window.setInterval(refresh, DEFAULTS.autoRefreshMs);
      window.requestAnimationFrame(function () {
        Object.keys(charts).forEach(function (k) {
          if (charts[k]) charts[k].resize();
        });
      });
    }

    function stop() {
      if (timer) {
        window.clearInterval(timer);
        timer = null;
      }
    }

    if (refreshBtn) {
      refreshBtn.addEventListener("click", function (e) {
        e.preventDefault();
        refresh();
      });
    }

    if (outlierInput) {
      // Keep Reveal from stealing arrow keys / space while editing the count
      ["keydown", "keypress", "keyup"].forEach(function (evt) {
        outlierInput.addEventListener(evt, function (e) {
          e.stopPropagation();
        });
      });
    }

    root._wtpElasticity = { start: start, stop: stop, refresh: refresh };
    return root._wtpElasticity;
  }

  function slideIsActive(root) {
    const slide = root.closest("section");
    if (!slide) return false;
    if (!window.Reveal || !Reveal.getCurrentSlide) return slide.classList.contains("present");
    const current = Reveal.getCurrentSlide();
    return slide === current || slide.contains(current) || current.contains(root);
  }

  function sync() {
    document.querySelectorAll("[data-wtp-count-live]").forEach(function (root) {
      const api = root._wtpCounter;
      if (!api) return;
      if (slideIsActive(root)) api.start();
      else api.stop();
    });
    document.querySelectorAll("[data-wtp-live]").forEach(function (root) {
      const api = root._wtpLive;
      if (!api) return;
      if (slideIsActive(root)) api.start();
      else api.stop();
    });
    document.querySelectorAll("[data-wtp-elasticity]").forEach(function (root) {
      const api = root._wtpElasticity;
      if (!api) return;
      if (slideIsActive(root)) api.start();
      else api.stop();
    });
  }

  function boot() {
    document.querySelectorAll("[data-wtp-qr-slide]").forEach(mountQrSlide);
    document.querySelectorAll("[data-wtp-count-live]").forEach(mountCounter);
    document.querySelectorAll("[data-wtp-live]").forEach(mountChart);
    document.querySelectorAll("[data-wtp-elasticity]").forEach(mountElasticity);

    if (window.Reveal) {
      Reveal.on("ready", sync);
      Reveal.on("slidechanged", sync);
      Reveal.on("resize", function () {
        document.querySelectorAll("[data-wtp-live], [data-wtp-elasticity]").forEach(function (root) {
          root.querySelectorAll("canvas").forEach(function (canvas) {
            if (typeof Chart !== "undefined" && canvas) {
              const inst = Chart.getChart(canvas);
              if (inst) inst.resize();
            }
          });
        });
      });
    } else {
      sync();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
