/**
 * Session 5 interactive widgets.
 *  - [data-baseline-weights]: bars of the baseline weights theta^(i-1) driven by a theta slider.
 *  - [data-baseline-example]: the baseline formula worked out for one promotion week, updated live with theta.
 *  - [data-season-baseline]: simulated seasonal sales with promotions; the weighted baseline and
 *    the resulting lift factors respond to theta and are compared with a simple-average baseline.
 *  - [data-lift-calc]: lift factor of a promotional event from log-linear demand estimates,
 *    Lift = (1 - gamma)^(-eta) * exp(beta_D * D) * exp(beta_F * F).
 * All theta sliders in the deck stay in sync.
 */
(function () {
  var MAX_LAG = 6;
  var COL = {
    sales: "#94a3b8",
    promo: "#b45309",
    promoBand: "rgba(180, 83, 9, 0.08)",
    baseline: "#0f766e",
    truth: "#1e293b",
    grid: "#e6edf2",
    frame: "#cbd5e1",
    text: "#1e293b",
    muted: "#64748b",
  };

  var thetaListeners = [];

  /** Notifies every theta widget except the one that triggered the change. */
  function broadcastTheta(value, source) {
    thetaListeners.forEach(function (listener) {
      if (listener.slider !== source) listener.sync(value);
    });
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  /** Reads a numeric input, falling back to its default value when the field is empty or invalid. */
  function readNumber(input) {
    var v = parseFloat(input.value);
    if (!isFinite(v)) v = parseFloat(input.defaultValue) || 0;
    var lo = input.min !== "" ? parseFloat(input.min) : -Infinity;
    var hi = input.max !== "" ? parseFloat(input.max) : Infinity;
    return clamp(v, lo, hi);
  }

  /**
   * Wires a theta slider: updates its <output>, calls onChange, and keeps other sliders in sync.
   * Returns the current theta.
   */
  function bindTheta(slider, out, onChange) {
    function apply() {
      var theta = readNumber(slider);
      if (out) out.textContent = theta.toFixed(2);
      onChange(theta);
      return theta;
    }
    slider.addEventListener("input", function () {
      broadcastTheta(apply(), slider);
    });
    thetaListeners.push({
      slider: slider,
      sync: function (value) {
        slider.value = value;
        apply();
      },
    });
    return apply();
  }

  function mountBaselineWeights(root) {
    var slider = root.querySelector("[data-theta]");
    var barsEl = root.querySelector("[data-weight-bars]");
    var note = root.querySelector("[data-weight-note]");
    if (!slider || !barsEl) return;

    var bars = [];
    for (var i = 1; i <= MAX_LAG; i++) {
      var bar = document.createElement("div");
      bar.className = "weight-bar";
      bar.innerHTML =
        '<span class="weight-val"></span>' +
        '<span class="weight-track"><span class="weight-fill"></span></span>' +
        '<span class="weight-lbl">' + i + "</span>";
      barsEl.appendChild(bar);
      bars.push(bar);
    }

    bindTheta(slider, root.querySelector("[data-theta-out]"), function (theta) {
      bars.forEach(function (bar, idx) {
        var w = Math.pow(theta, idx);
        bar.querySelector(".weight-fill").style.height = (w * 100).toFixed(1) + "%";
        bar.querySelector(".weight-val").textContent = w.toFixed(2);
      });
      if (note) {
        var nearShare = ((1 - theta) * (1 + theta)) / (1 - Math.pow(theta, MAX_LAG));
        note.textContent =
          "The two nearest pairs of weeks carry " + Math.round(nearShare * 100) + "% of the total weight.";
      }
    });
  }

  /* ----- Seasonal baseline demo ----- */

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randn(rng) {
    var u = rng();
    var v = rng();
    while (u <= 1e-12) u = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Log-linear demand parameters shared by the simulated data (same defaults as the lift calculator). */
  var MODEL = { eta: 2, betaD: 0.5, betaF: 0.3, basePrice: 3.49 };

  /**
   * Promotion events by week: TPR depth (gamma) and %ACV on display (D) and feature (F).
   * Most promotions fall in high season (summer and the holidays), as they often do in practice.
   */
  var PROMO_EVENTS = {
    6: { gamma: 0.1, D: 0.3, F: 0.5 },
    15: { gamma: 0.15, D: 0.6, F: 0.8 },
    16: { gamma: 0.1, D: 0.5, F: 0 },
    21: { gamma: 0.12, D: 0.6, F: 0.6 },
    24: { gamma: 0.2, D: 0.4, F: 0.8 },
    29: { gamma: 0.15, D: 0.5, F: 0.4 },
    36: { gamma: 0.1, D: 0.7, F: 0.3 },
    44: { gamma: 0.15, D: 0.8, F: 0.5 },
    49: { gamma: 0.12, D: 0.5, F: 0.5 },
  };

  var seasonalDataCache = null;

  /** 52 weeks of sales = seasonal demand × promotion lift (from the log-linear model) × noise. */
  function makeSeasonalData() {
    if (seasonalDataCache) return seasonalDataCache;
    var WEEKS = 52;
    var rng = mulberry32(20261102);
    var weeks = [];
    for (var w = 1; w <= WEEKS; w++) {
      var season =
        400 * (1 + 0.32 * Math.sin((2 * Math.PI * (w - 9)) / WEEKS) + 0.06 * Math.sin((4 * Math.PI * w) / WEEKS));
      if (w >= 48 && w <= 51) season *= 1.25;
      var ev = PROMO_EVENTS[w] || { gamma: 0, D: 0, F: 0 };
      var lift =
        Math.pow(1 - ev.gamma, -MODEL.eta) * Math.exp(MODEL.betaD * ev.D) * Math.exp(MODEL.betaF * ev.F);
      weeks.push({
        week: w,
        season: season,
        promo: !!PROMO_EVENTS[w],
        trueLift: lift,
        price: Math.round(MODEL.basePrice * (1 - ev.gamma) * 100) / 100,
        display: ev.D,
        feature: ev.F,
        sales: season * lift * Math.exp(0.06 * randn(rng)),
      });
    }
    seasonalDataCache = weeks;
    return weeks;
  }

  /** Fills each [data-sample-rows="from-to"] tbody with the simulated weekly data. */
  function mountSampleData(section) {
    var data = makeSeasonalData();
    Array.prototype.forEach.call(section.querySelectorAll("[data-sample-rows]"), function (tbody) {
      var range = tbody.getAttribute("data-sample-rows").split("-").map(Number);
      var html = "";
      data.slice(range[0] - 1, range[1]).forEach(function (d) {
        html +=
          "<tr" + (d.promo ? ' class="promo"' : "") + ">" +
          "<td>" + d.week + "</td>" +
          "<td>" + Math.round(d.sales) + "</td>" +
          "<td>" + d.price.toFixed(2) + "</td>" +
          "<td>" + d.display.toFixed(2) + "</td>" +
          "<td>" + d.feature.toFixed(2) + "</td>" +
          "</tr>";
      });
      tbody.innerHTML = html;
    });
  }

  /**
   * Lag terms of the baseline at index t: for lag i = 1..MAX_LAG, the i-th nearest non-promoted week
   * before and after t (null when that side runs out of weeks). Lags with no week on either side are dropped.
   */
  function baselineTerms(data, t) {
    var before = [];
    var after = [];
    for (var s = t - 1; s >= 0 && before.length < MAX_LAG; s--) {
      if (!data[s].promo) before.push(data[s]);
    }
    for (var u = t + 1; u < data.length && after.length < MAX_LAG; u++) {
      if (!data[u].promo) after.push(data[u]);
    }
    var terms = [];
    for (var i = 0; i < MAX_LAG; i++) {
      if (!before[i] && !after[i]) break;
      terms.push({ lag: i + 1, before: before[i] || null, after: after[i] || null });
    }
    return terms;
  }

  /** Average of a lag term's two weeks (or the single available week), using valueOf(week) as the sales value. */
  function termAverage(term, valueOf) {
    var values = [];
    if (term.before) values.push(valueOf(term.before));
    if (term.after) values.push(valueOf(term.after));
    return mean(values);
  }

  function salesOf(d) {
    return d.sales;
  }

  /** Weighted average of the nearest non-promoted weeks on each side of index t (weights theta^(i-1)). */
  function weightedBaseline(data, t, theta) {
    var sum = 0;
    var wsum = 0;
    baselineTerms(data, t).forEach(function (term) {
      var w = Math.pow(theta, term.lag - 1);
      sum += w * termAverage(term, salesOf);
      wsum += w;
    });
    return wsum > 0 ? sum / wsum : NaN;
  }

  function estimate(data, theta) {
    var nonPromo = data.filter(function (d) { return !d.promo; });
    var simple = nonPromo.reduce(function (acc, d) { return acc + d.sales; }, 0) / nonPromo.length;
    var baseline = data.map(function (d, t) { return weightedBaseline(data, t, theta); });
    var events = [];
    data.forEach(function (d, t) {
      if (!d.promo) return;
      events.push({
        week: d.week,
        trueLift: d.trueLift,
        weighted: d.sales / baseline[t],
        simple: d.sales / simple,
      });
    });
    return { simple: simple, baseline: baseline, events: events };
  }

  function mean(values) {
    return values.reduce(function (a, b) { return a + b; }, 0) / values.length;
  }

  function drawSeasonal(canvas, data, est) {
    var cssW = canvas.clientWidth;
    var cssH = canvas.clientHeight;
    if (cssW < 40 || cssH < 40) return;

    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cssW, cssH);

    var pad = { l: 54, r: 14, t: 14, b: 36 };
    var gap = 26;
    var plotW = cssW - pad.l - pad.r;
    var totalH = cssH - pad.t - pad.b - gap;
    var topH = totalH * 0.63;
    var botH = totalH - topH;
    var topY0 = pad.t;
    var botY0 = pad.t + topH + gap;

    var n = data.length;
    function X(week) { return pad.l + ((week - 0.5) / n) * plotW; }

    var maxSales = Math.max.apply(null, data.map(function (d) { return d.sales; }));
    var yTopMax = Math.ceil((maxSales * 1.08) / 200) * 200;
    function Ytop(v) { return topY0 + topH - (v / yTopMax) * topH; }

    var maxLift = Math.max.apply(null, est.events.map(function (e) {
      return Math.max(e.trueLift, e.weighted, e.simple);
    }));
    var yBotMax = Math.ceil(maxLift + 0.3);
    function Ybot(v) { return botY0 + botH - (v / yBotMax) * botH; }

    ctx.font = "600 11px 'Source Sans 3', sans-serif";

    // Promotion bands across both panels
    ctx.fillStyle = COL.promoBand;
    data.forEach(function (d) {
      if (!d.promo) return;
      var x0 = X(d.week - 0.5);
      var x1 = X(d.week + 0.5);
      ctx.fillRect(x0, topY0, x1 - x0, topH);
      ctx.fillRect(x0, botY0, x1 - x0, botH);
    });

    // Grids and y labels
    ctx.strokeStyle = COL.grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = COL.muted;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (var yv = 0; yv <= yTopMax; yv += 200) {
      ctx.beginPath();
      ctx.moveTo(pad.l, Ytop(yv));
      ctx.lineTo(pad.l + plotW, Ytop(yv));
      ctx.stroke();
      ctx.fillText(String(yv), pad.l - 6, Ytop(yv));
    }
    for (var lv = 0; lv <= yBotMax; lv += 1) {
      ctx.beginPath();
      ctx.moveTo(pad.l, Ybot(lv));
      ctx.lineTo(pad.l + plotW, Ybot(lv));
      ctx.stroke();
      ctx.fillText(String(lv), pad.l - 6, Ybot(lv));
    }

    // X labels
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (var wk = 4; wk <= n; wk += 4) {
      ctx.fillText(String(wk), X(wk), botY0 + botH + 5);
    }

    // Axis titles
    ctx.fillStyle = COL.text;
    ctx.font = "700 12px 'Source Sans 3', sans-serif";
    ctx.fillText("Week", pad.l + plotW / 2, cssH - 15);
    function yTitle(label, yMid) {
      ctx.save();
      ctx.translate(13, yMid);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
    yTitle("Unit sales", topY0 + topH / 2);
    yTitle("Lift factor", botY0 + botH / 2);

    function line(values, color, width, dash) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash || []);
      ctx.beginPath();
      values.forEach(function (v, i) {
        var x = X(data[i].week);
        var y = Ytop(v);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.restore();
    }

    // Top panel series
    line(data.map(function (d) { return d.season; }), COL.truth, 1.4, [3, 3]);
    line(data.map(function (d) { return d.sales; }), COL.sales, 1.6);
    data.forEach(function (d) {
      ctx.fillStyle = d.promo ? COL.promo : COL.sales;
      ctx.beginPath();
      ctx.arc(X(d.week), Ytop(d.sales), d.promo ? 3.8 : 2.6, 0, Math.PI * 2);
      ctx.fill();
    });
    line(data.map(function () { return est.simple; }), COL.promo, 2, [7, 4]);
    line(est.baseline, COL.baseline, 2.6);

    // Bottom panel: lift factors per promotion week
    est.events.forEach(function (e) {
      var x = X(e.week);
      ctx.fillStyle = COL.promo;
      ctx.fillRect(x + 1, Ybot(e.simple) - 3.5, 7, 7);
      ctx.fillStyle = COL.baseline;
      ctx.beginPath();
      ctx.arc(x - 4, Ybot(e.weighted), 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = COL.truth;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(x, Ybot(e.trueLift), 5.5, 0, Math.PI * 2);
      ctx.stroke();
    });

    ctx.strokeStyle = COL.frame;
    ctx.lineWidth = 1;
    ctx.strokeRect(pad.l, topY0, plotW, topH);
    ctx.strokeRect(pad.l, botY0, plotW, botH);

    // Legend (top panel, upper right)
    var legend = [
      { label: "Weekly sales (promotion weeks in orange)", kind: "dot", color: COL.sales },
      { label: "Weighted baseline (θ)", kind: "line", color: COL.baseline },
      { label: "Simple average of non-promoted weeks", kind: "dash", color: COL.promo },
      { label: "Seasonal demand (unknown in practice)", kind: "dot-line", color: COL.truth },
    ];
    ctx.font = "600 11px 'Source Sans 3', sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    var legendW = 22 + Math.max.apply(null, legend.map(function (item) { return ctx.measureText(item.label).width; }));
    var lx = pad.l + plotW - legendW - 10;
    var ly = topY0 + 10;
    ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
    ctx.fillRect(lx - 4, ly - 7, legendW + 8, legend.length * 15 + 2);
    legend.forEach(function (item, idx) {
      var y = ly + idx * 15;
      ctx.save();
      ctx.strokeStyle = item.color;
      ctx.fillStyle = item.color;
      ctx.lineWidth = 2.2;
      if (item.kind === "dot") {
        ctx.beginPath();
        ctx.arc(lx + 8, y, 3, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.setLineDash(item.kind === "dash" ? [6, 3] : item.kind === "dot-line" ? [3, 3] : []);
        if (item.kind === "dot-line") ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(lx, y);
        ctx.lineTo(lx + 16, y);
        ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = COL.text;
      ctx.fillText(item.label, lx + 22, y);
    });

    // Legend (bottom panel, upper right)
    var bl = [
      { label: "True lift", kind: "ring" },
      { label: "Weighted baseline", kind: "dot" },
      { label: "Simple average", kind: "square" },
    ];
    var blW = bl.reduce(function (acc, item) { return acc + 14 + ctx.measureText(item.label).width + 16; }, -16);
    var bx = pad.l + plotW - blW - 10;
    var by = botY0 + 10;
    ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
    ctx.fillRect(bx - 4, by - 7, blW + 8, 15);
    bl.forEach(function (item) {
      if (item.kind === "ring") {
        ctx.strokeStyle = COL.truth;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(bx + 5, by, 4.5, 0, Math.PI * 2);
        ctx.stroke();
      } else if (item.kind === "dot") {
        ctx.fillStyle = COL.baseline;
        ctx.beginPath();
        ctx.arc(bx + 5, by, 4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = COL.promo;
        ctx.fillRect(bx + 1.5, by - 3.5, 7, 7);
      }
      ctx.fillStyle = COL.text;
      ctx.fillText(item.label, bx + 14, by);
      bx += 14 + ctx.measureText(item.label).width + 16;
    });
  }

  function mountSeasonalBaseline(section) {
    var canvas = section.querySelector("[data-season-plot]");
    var slider = section.querySelector("[data-theta]");
    if (!canvas || !slider || typeof Reveal === "undefined") return;

    var data = makeSeasonalData();
    var est = null;
    var slides = Array.prototype.slice.call(document.querySelectorAll(".reveal .slides > section"));
    var index = slides.indexOf(section);

    function setOut(key, text) {
      var el = section.querySelector('[data-season-out="' + key + '"]');
      if (el) el.textContent = text;
    }

    function render() {
      if (est) drawSeasonal(canvas, data, est);
    }

    bindTheta(slider, section.querySelector("[data-theta-out]"), function (theta) {
      est = estimate(data, theta);
      var trueAvg = mean(est.events.map(function (e) { return e.trueLift; }));
      setOut("trueLift", trueAvg.toFixed(2));
      setOut("weightedLift", mean(est.events.map(function (e) { return e.weighted; })).toFixed(2));
      setOut("simpleLift", mean(est.events.map(function (e) { return e.simple; })).toFixed(2));
      var errW = mean(est.events.map(function (e) { return Math.abs(e.weighted - e.trueLift); }));
      var errS = mean(est.events.map(function (e) { return Math.abs(e.simple - e.trueLift); }));
      var errEl = section.querySelector("[data-season-error]");
      if (errEl) {
        errEl.textContent =
          "Average error per promotion: weighted " + errW.toFixed(2) + " · simple average " + errS.toFixed(2);
      }
      render();
    });

    Reveal.on("slidechanged", function () {
      if (Reveal.getIndices().h === index) render();
    });
    window.addEventListener("resize", function () {
      if (Reveal.getIndices().h === index) render();
    });
  }

  /** Formats a number for TeX, with a thousands separator that KaTeX does not space as punctuation. */
  function texNum(v, digits) {
    return v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace(/,/g, "{,}");
  }

  /**
   * Renders TeX into el. The math plugin loads KaTeX asynchronously (after Reveal is ready), so until it
   * is available the latest TeX is kept and retried; after ~10 s the raw source is shown instead.
   */
  function renderTex(el, tex, attempt) {
    el.__tex = tex;
    if (window.katex) {
      window.katex.render(tex, el, { displayMode: true, throwOnError: false });
      return;
    }
    if ((attempt || 0) >= 100) {
      el.textContent = tex;
      return;
    }
    setTimeout(function () {
      if (el.__tex === tex) renderTex(el, tex, (attempt || 0) + 1);
    }, 100);
  }

  /**
   * Worked example of the baseline formula for one promotion week (section attribute data-week).
   * Uses rounded weekly units so the numbers on the slide can be checked by hand.
   */
  function mountBaselineExample(section) {
    var slider = section.querySelector("[data-theta]");
    var rowsEl = section.querySelector("[data-bx-rows]");
    var eqEl = section.querySelector("[data-bx-eq]");
    var data = makeSeasonalData();
    var week = parseInt(section.getAttribute("data-week"), 10);
    var t = week - 1;
    if (!slider || !rowsEl || !eqEl || !data[t] || !data[t].promo) return;

    function units(d) {
      return Math.round(d.sales);
    }
    function setOut(key, text) {
      var el = section.querySelector('[data-bx-out="' + key + '"]');
      if (el) el.textContent = text;
    }

    var qt = units(data[t]);
    var terms = baselineTerms(data, t).map(function (term) {
      term.avg = termAverage(term, units);
      return term;
    });

    rowsEl.innerHTML =
      terms.map(function (term) {
        return (
          "<tr>" +
          "<td>" + term.lag + "</td>" +
          "<td>" + (term.before ? term.before.week : "–") + " · " + (term.after ? term.after.week : "–") + "</td>" +
          "<td>" + (term.before ? units(term.before) : "–") + "</td>" +
          "<td>" + (term.after ? units(term.after) : "–") + "</td>" +
          "<td>" + term.avg.toFixed(1) + "</td>" +
          '<td class="live" data-bx-weight></td>' +
          '<td class="live" data-bx-product></td>' +
          "</tr>"
        );
      }).join("") +
      '<tr class="total"><td colspan="5" class="left">Sum</td><td class="live" data-bx-wsum></td><td class="live" data-bx-sum></td></tr>';

    var weightCells = rowsEl.querySelectorAll("[data-bx-weight]");
    var productCells = rowsEl.querySelectorAll("[data-bx-product]");
    setOut("qt", qt.toLocaleString("en-US") + " units");

    var used = [];
    terms.forEach(function (term) {
      if (term.before) used.push(term.before.week);
      if (term.after) used.push(term.after.week);
    });
    var first = Math.min.apply(null, used);
    var last = Math.max.apply(null, used);
    var skipped = data.filter(function (d) {
      return d.promo && d.week !== week && d.week > first && d.week < last;
    }).map(function (d) { return d.week; });
    if (skipped.length) {
      setOut(
        "skipped",
        "(promotion week" + (skipped.length > 1 ? "s " : " ") +
          skipped.slice(0, -1).join(", ") + (skipped.length > 1 ? " and " : "") + skipped[skipped.length - 1] +
          (skipped.length > 1 ? " are" : " is") + " skipped)"
      );
    }
    setOut("truth", "True lift (known only because the data are simulated): " + data[t].trueLift.toFixed(2));

    bindTheta(slider, section.querySelector("[data-theta-out]"), function (theta) {
      var sum = 0;
      var wsum = 0;
      var parts = terms.map(function (term, idx) {
        var w = Math.pow(theta, term.lag - 1);
        sum += w * term.avg;
        wsum += w;
        weightCells[idx].textContent = w.toFixed(2);
        productCells[idx].textContent = (w * term.avg).toFixed(1);
        return idx === 0 ? texNum(term.avg, 1) : texNum(w, 2) + " \\cdot " + texNum(term.avg, 1);
      });
      rowsEl.querySelector("[data-bx-wsum]").textContent = wsum.toFixed(2);
      rowsEl.querySelector("[data-bx-sum]").textContent = sum.toFixed(1);

      var th = texNum(theta, 2);
      var L = terms.length;
      var factor = (1 - theta) / (1 - Math.pow(theta, L));
      var baseline = factor * sum;
      renderTex(
        eqEl,
        "\\begin{aligned} Q_{" + week + "}^{\\text{baseline}} &= \\frac{1-" + th + "}{1-" + th + "^{" + L + "}}" +
          "\\left(" + parts.join(" + ") + "\\right) \\\\" +
          " &= \\frac{" + texNum(1 - theta, 2) + "}{" + texNum(1 - Math.pow(theta, L), 3) + "} \\times " +
          texNum(sum, 1) + " = " + texNum(factor, 4) + " \\times " + texNum(sum, 1) +
          " = \\mathbf{" + texNum(baseline, 1) + "} \\end{aligned}"
      );
      setOut("baseline", baseline.toFixed(1));
      setOut("lift", (qt / baseline).toFixed(2));
    });
  }

  function mountLiftCalculator(root) {
    var inputs = {};
    Array.prototype.forEach.call(root.querySelectorAll("[data-lift-input]"), function (el) {
      inputs[el.getAttribute("data-lift-input")] = el;
    });
    var required = ["eta", "betaD", "betaF", "gamma", "display", "feature", "baseline"];
    if (required.some(function (k) { return !inputs[k]; })) return;

    function setOut(key, text) {
      var el = root.querySelector('[data-lift-out="' + key + '"]');
      if (el) el.textContent = text;
    }

    function update() {
      var eta = readNumber(inputs.eta);
      var gamma = readNumber(inputs.gamma) / 100;
      var display = readNumber(inputs.display) / 100;
      var feature = readNumber(inputs.feature) / 100;
      var baseline = readNumber(inputs.baseline);

      var priceMult = Math.pow(1 - gamma, -eta);
      var displayMult = Math.exp(readNumber(inputs.betaD) * display);
      var featureMult = Math.exp(readNumber(inputs.betaF) * feature);
      var lift = priceMult * displayMult * featureMult;

      setOut("price", "\u00d7" + priceMult.toFixed(2));
      setOut("display", "\u00d7" + displayMult.toFixed(2));
      setOut("feature", "\u00d7" + featureMult.toFixed(2));
      setOut("lift", lift.toFixed(2));
      setOut("dq", Math.round((lift - 1) * baseline).toLocaleString("en-US"));
    }

    Object.keys(inputs).forEach(function (k) {
      inputs[k].addEventListener("input", update);
    });
    update();
  }

  window.startPromoTools = function () {
    if (window.__promoToolsStarted) return;
    window.__promoToolsStarted = true;
    Array.prototype.forEach.call(document.querySelectorAll("[data-baseline-weights]"), mountBaselineWeights);
    Array.prototype.forEach.call(document.querySelectorAll("[data-baseline-example]"), mountBaselineExample);
    Array.prototype.forEach.call(document.querySelectorAll("[data-season-baseline]"), mountSeasonalBaseline);
    Array.prototype.forEach.call(document.querySelectorAll("[data-sample-data]"), mountSampleData);
    Array.prototype.forEach.call(document.querySelectorAll("[data-lift-calc]"), mountLiftCalculator);
  };
})();
