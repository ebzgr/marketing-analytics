/**
 * Live omitted-variable-bias simulation for Session 4, slides 21–22.
 *
 * Data generating process, repeated for 1,000 data sets of 100 observations:
 *   x1, x2 ~ standard bivariate normal with correlation rho
 *   epsilon ~ N(0, 1), independent of x
 *   y = 0 - 2 x1 + beta2 x2 + epsilon
 *
 * Each data set is estimated twice: with x2 included, and with x2 omitted.
 * Slide 22 always shows this for rho = 0 and for the correlation chosen on
 * slide 21. With unit-variance regressors the omitted-variable bias is
 * beta2 * rho, so the omitted-and-correlated histogram should center on
 * -2 + beta2 * rho.
 *
 * The random draws are seeded, so the same settings always reproduce the
 * same figure.
 */
(function () {
  var REPS = 1000;
  var OBS = 100;
  var BETA1 = -2;
  var SEED = 20251005;

  var COL = {
    bar: "#c5dff0",
    barEdge: "#6fa3c4",
    mean: "#e11d74",
    truth: "#1e293b",
    grid: "#e6edf2",
    text: "#1e293b",
    muted: "#64748b",
  };

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

  /** Coefficient of x1 in y = a + b1 x1 + e. */
  function olsSlope(n, sx, sxx, sy, sxy) {
    var det = n * sxx - sx * sx;
    if (Math.abs(det) < 1e-10) return NaN;
    return (n * sxy - sx * sy) / det;
  }

  /** Coefficient of x1 in y = a + b1 x1 + b2 x2 + e. */
  function olsSlopeTwo(n, sx1, sx2, sxx1, sxx2, sx12, sy, sx1y, sx2y) {
    var m = [
      [n, sx1, sx2, sy],
      [sx1, sxx1, sx12, sx1y],
      [sx2, sx12, sxx2, sx2y],
    ];
    for (var col = 0; col < 3; col++) {
      var pivot = col;
      for (var row = col + 1; row < 3; row++) {
        if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
      }
      if (pivot !== col) {
        var swap = m[col];
        m[col] = m[pivot];
        m[pivot] = swap;
      }
      var div = m[col][col];
      if (Math.abs(div) < 1e-10) return NaN;
      for (var r = col + 1; r < 3; r++) {
        var factor = m[r][col] / div;
        for (var c = col; c < 4; c++) m[r][c] -= factor * m[col][c];
      }
    }
    var x = [0, 0, 0];
    for (var i = 2; i >= 0; i--) {
      var sum = m[i][3];
      for (var k = i + 1; k < 3; k++) sum -= m[i][k] * x[k];
      x[i] = sum / m[i][i];
    }
    return x[1];
  }

  /**
   * One Monte Carlo for a fixed correlation.
   * Returns the estimated coefficient of x1 with x2 included and omitted.
   */
  function replicateCorrelation(beta2, rho, seed) {
    var rng = mulberry32(seed);
    var scale = Math.sqrt(Math.max(0, 1 - rho * rho));
    var included = new Float64Array(REPS);
    var omitted = new Float64Array(REPS);

    for (var rep = 0; rep < REPS; rep++) {
      var sx1 = 0, sx2 = 0, sy = 0;
      var sxx1 = 0, sxx2 = 0, sx12 = 0;
      var sx1y = 0, sx2y = 0;
      for (var i = 0; i < OBS; i++) {
        var x1 = randn(rng);
        var x2 = rho * x1 + scale * randn(rng);
        var y = BETA1 * x1 + beta2 * x2 + randn(rng);
        sx1 += x1;
        sx2 += x2;
        sy += y;
        sxx1 += x1 * x1;
        sxx2 += x2 * x2;
        sx12 += x1 * x2;
        sx1y += x1 * y;
        sx2y += x2 * y;
      }
      included[rep] = olsSlopeTwo(OBS, sx1, sx2, sxx1, sxx2, sx12, sy, sx1y, sx2y);
      omitted[rep] = olsSlope(OBS, sx1, sxx1, sy, sx1y);
    }
    return { included: included, omitted: omitted };
  }

  function mean(values) {
    var sum = 0;
    var count = 0;
    for (var i = 0; i < values.length; i++) {
      if (isFinite(values[i])) {
        sum += values[i];
        count++;
      }
    }
    return count ? sum / count : NaN;
  }

  function niceBin(raw) {
    var steps = [0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2];
    for (var i = 0; i < steps.length; i++) {
      if (raw <= steps[i]) return steps[i];
    }
    return Math.ceil(raw);
  }

  function histogram(values, xMin, xMax, bin) {
    var bins = Math.max(1, Math.round((xMax - xMin) / bin));
    var counts = new Array(bins).fill(0);
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      if (!isFinite(v)) continue;
      var k = Math.floor((v - xMin) / bin);
      if (k < 0) k = 0;
      if (k >= bins) k = bins - 1;
      counts[k]++;
    }
    var share = new Array(bins);
    for (var b = 0; b < bins; b++) share[b] = counts[b] / REPS;
    return share;
  }

  /**
   * @returns {{beta2:number, rho:number, panels:Array, xMin:number, xMax:number, bin:number, yMax:number}}
   */
  function simulate(beta2, rho) {
    var uncorr = replicateCorrelation(beta2, 0, SEED);
    var corr = replicateCorrelation(beta2, rho, SEED + 1);
    var panels = [
      { row: 0, col: 0, values: uncorr.included, mean: mean(uncorr.included) },
      { row: 0, col: 1, values: corr.included, mean: mean(corr.included) },
      { row: 1, col: 0, values: uncorr.omitted, mean: mean(uncorr.omitted) },
      { row: 1, col: 1, values: corr.omitted, mean: mean(corr.omitted) },
    ];

    var lo = BETA1;
    var hi = BETA1;
    panels.forEach(function (panel) {
      for (var i = 0; i < panel.values.length; i++) {
        var v = panel.values[i];
        if (!isFinite(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    });
    var span = Math.max(hi - lo, 0.4);
    var bin = niceBin(span / 40);
    var xMin = Math.floor((lo - bin) / bin) * bin;
    var xMax = Math.ceil((hi + bin) / bin) * bin;

    var yMax = 0.05;
    panels.forEach(function (panel) {
      panel.share = histogram(panel.values, xMin, xMax, bin);
      for (var i = 0; i < panel.share.length; i++) {
        if (panel.share[i] > yMax) yMax = panel.share[i];
      }
    });
    yMax = Math.ceil((yMax * 1.12) / 0.05) * 0.05;

    return { beta2: beta2, rho: rho, panels: panels, xMin: xMin, xMax: xMax, bin: bin, yMax: yMax };
  }

  function formatNum(value, digits) {
    var text = value.toFixed(digits);
    if (text === "-0.00" || text === "-0.0") return (0).toFixed(digits);
    return text;
  }

  function signed(value) {
    var text = formatNum(Math.abs(value), 2);
    return value < 0 ? "\u2212" + text : text;
  }

  function coefText(beta2) {
    var rounded = Math.round(beta2 * 100) / 100;
    var body = formatNum(Math.abs(rounded), Math.abs(rounded) % 1 === 0 ? 0 : 2);
    if (rounded < 0) return "(-" + body + ")";
    return body;
  }

  function renderEquation(beta2) {
    var el = document.querySelector("[data-ovb-equation]");
    if (!el) return;
    var tex = "y = 0 - 2x_1 + " + coefText(beta2) + "x_2 + \\epsilon";
    if (typeof katex !== "undefined") {
      katex.render(tex, el, { displayMode: true, throwOnError: false });
    } else {
      el.textContent = "y = 0 \u2212 2x\u2081 + " + coefText(beta2) + "x\u2082 + \u03b5";
    }
  }

  function clamp(value, lo, hi, fallback) {
    var n = Number(value);
    if (!isFinite(n)) return fallback;
    return Math.min(hi, Math.max(lo, n));
  }

  function readSettings(scope) {
    var betaInput = scope.querySelector("[data-ovb-beta2]");
    var rhoInput = scope.querySelector("[data-ovb-rho]");
    return {
      beta2: clamp(betaInput && betaInput.value, -5, 5, 1),
      rho: clamp(rhoInput && rhoInput.value, -0.95, 0.95, 0.5),
    };
  }

  function writeSettings(beta2, rho) {
    document.querySelectorAll("[data-ovb-beta2]").forEach(function (input) {
      input.value = String(Math.round(beta2 * 100) / 100);
    });
    document.querySelectorAll("[data-ovb-rho]").forEach(function (input) {
      input.value = String(rho);
    });
    document.querySelectorAll("[data-ovb-rho-out]").forEach(function (output) {
      output.textContent = formatNum(rho, 2);
    });
  }

  function biasSentence(beta2, rho) {
    var bias = beta2 * rho;
    var center = BETA1 + bias;
    return (
      "Omit x\u2082 \u21d2 bias = \u03b2\u2082 \u00d7 \u03c1 = " + signed(bias) +
      " (centers near " + signed(center) + "). Include x\u2082 \u21d2 stays at \u22122."
    );
  }

  function updatePrediction(beta2, rho) {
    document.querySelectorAll("[data-ovb-status]").forEach(function (el) {
      el.textContent = biasSentence(beta2, rho);
    });
  }

  function updateCaption(beta2, rho) {
    var caption = document.querySelector("[data-ovb-caption]");
    if (!caption) return;
    caption.textContent =
      "Pink line = average estimate across 1,000 data sets \u00b7 dashed line = true coefficient (\u22122). " +
      "Left column: correlation = 0. Right column: correlation = " + formatNum(rho, 2) +
      ", coefficient of x\u2082 = " + formatNum(beta2, 2) + ".";
  }

  function draw(result) {
    var canvas = document.querySelector("[data-ovb-plot]");
    if (!canvas || !result) return;
    var cssW = canvas.clientWidth;
    var cssH = canvas.clientHeight;
    if (cssW < 20 || cssH < 20) return;

    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cssW, cssH);

    var margin = { left: 108, right: 16, top: 34, bottom: 46 };
    var gapX = 22;
    var gapY = 28;
    var panelW = (cssW - margin.left - margin.right - gapX) / 2;
    var panelH = (cssH - margin.top - margin.bottom - gapY) / 2;
    if (panelW < 40 || panelH < 40) return;

    var titles = ["Uncorrelated  (\u03c1 = 0)", "Your correlation  (\u03c1 = " + formatNum(result.rho, 2) + ")"];
    var rows = ["x\u2082 included", "x\u2082 omitted"];

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = COL.text;
    ctx.font = "700 15px 'Source Sans 3', sans-serif";
    for (var col = 0; col < 2; col++) {
      ctx.fillText(titles[col], margin.left + col * (panelW + gapX) + panelW / 2, 16);
    }

    ctx.fillStyle = COL.muted;
    ctx.font = "700 13px 'Source Sans 3', sans-serif";
    for (var row = 0; row < 2; row++) {
      ctx.save();
      ctx.translate(16, margin.top + row * (panelH + gapY) + panelH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(rows[row], 0, 0);
      ctx.restore();
    }

    ctx.font = "600 13px 'Source Sans 3', sans-serif";
    ctx.fillStyle = COL.text;
    ctx.fillText("Estimates of \u03b2\u2081", margin.left + (cssW - margin.left - margin.right) / 2, cssH - 12);

    result.panels.forEach(function (panel) {
      var x0 = margin.left + panel.col * (panelW + gapX);
      var y0 = margin.top + panel.row * (panelH + gapY);
      drawPanel(ctx, panel, x0, y0, panelW, panelH, result);
    });
  }

  function xPixel(value, x0, panelW, result) {
    return x0 + ((value - result.xMin) / (result.xMax - result.xMin)) * panelW;
  }

  function yPixel(share, y0, panelH, result) {
    return y0 + panelH - (share / result.yMax) * panelH;
  }

  function drawPanel(ctx, panel, x0, y0, panelW, panelH, result) {
    var yStep = result.yMax > 0.3 ? 0.1 : 0.05;
    var xStep = niceBin((result.xMax - result.xMin) / 5);

    ctx.font = "12px 'Source Sans 3', sans-serif";
    ctx.fillStyle = COL.muted;
    if (panel.col === 0) {
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (var tick = 0; tick <= result.yMax + 1e-9; tick += yStep) {
        ctx.fillText(tick.toFixed(2), x0 - 6, yPixel(tick, y0, panelH, result));
      }
    }
    if (panel.row === 1) {
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (var label = Math.ceil(result.xMin / xStep) * xStep; label <= result.xMax + 1e-9; label += xStep) {
        ctx.fillText(signed(label), xPixel(label, x0, panelW, result), y0 + panelH + 4);
      }
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, panelW, panelH);
    ctx.clip();

    ctx.strokeStyle = COL.grid;
    ctx.lineWidth = 1;
    for (var gy = 0; gy <= result.yMax + 1e-9; gy += yStep) {
      var py = yPixel(gy, y0, panelH, result);
      ctx.beginPath();
      ctx.moveTo(x0, py);
      ctx.lineTo(x0 + panelW, py);
      ctx.stroke();
    }
    for (var gx = Math.ceil(result.xMin / xStep) * xStep; gx <= result.xMax + 1e-9; gx += xStep) {
      var px = xPixel(gx, x0, panelW, result);
      ctx.beginPath();
      ctx.moveTo(px, y0);
      ctx.lineTo(px, y0 + panelH);
      ctx.stroke();
    }

    var binPx = (result.bin / (result.xMax - result.xMin)) * panelW;
    ctx.fillStyle = COL.bar;
    ctx.strokeStyle = COL.barEdge;
    ctx.lineWidth = 1;
    for (var b = 0; b < panel.share.length; b++) {
      var bx = xPixel(result.xMin + b * result.bin, x0, panelW, result);
      var by = yPixel(panel.share[b], y0, panelH, result);
      var bh = y0 + panelH - by;
      ctx.fillRect(bx + 0.5, by, Math.max(0, binPx - 1), bh);
      ctx.strokeRect(bx + 0.5, by, Math.max(0, binPx - 1), bh);
    }

    var separated = Math.abs(panel.mean - BETA1) > Math.max(0.04, result.bin * 0.6);
    if (separated) {
      strokeVLine(ctx, xPixel(BETA1, x0, panelW, result), y0, panelH, COL.truth, [5, 3], 1.6);
    }
    strokeVLine(ctx, xPixel(panel.mean, x0, panelW, result), y0, panelH, COL.mean, [], 2.25);

    ctx.font = "700 12px 'Source Sans 3', sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#ffffff";
    ctx.strokeText("mean " + signed(panel.mean), x0 + panelW - 6, y0 + 5);
    ctx.fillStyle = COL.mean;
    ctx.fillText("mean " + signed(panel.mean), x0 + panelW - 6, y0 + 5);
    ctx.restore();

    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 1;
    ctx.strokeRect(x0, y0, panelW, panelH);
  }

  function strokeVLine(ctx, x, y, h, color, dash, width) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + h);
    ctx.stroke();
    ctx.restore();
  }

  function mount() {
    var setup = document.querySelector("[data-ovb-setup]");
    var results = document.querySelector("[data-ovb-results]");
    if (!setup || !results || typeof Reveal === "undefined") return;

    var sections = Array.prototype.slice.call(document.querySelectorAll(".reveal .slides > section"));
    var resultsIndex = sections.indexOf(results);
    var current = { beta2: 1, rho: 0.5, result: null };

    function apply(beta2, rho) {
      current.beta2 = beta2;
      current.rho = rho;
      writeSettings(beta2, rho);
      renderEquation(beta2);
      updatePrediction(beta2, rho);
      updateCaption(beta2, rho);
      current.result = simulate(beta2, rho);
      draw(current.result);
    }

    function pending() {
      var betaInput = setup.querySelector("[data-ovb-beta2]");
      var rhoInput = setup.querySelector("[data-ovb-rho]");
      return {
        beta2: clamp(betaInput.value, -5, 5, current.beta2),
        rho: clamp(rhoInput.value, -0.95, 0.95, current.rho),
      };
    }

    function runFrom(scope) {
      var settings = readSettings(scope);
      apply(settings.beta2, settings.rho);
    }

    document.querySelectorAll("[data-ovb-run]").forEach(function (button) {
      button.addEventListener("click", function () {
        runFrom(button.parentElement);
      });
    });

    document.querySelectorAll("[data-ovb-rho]").forEach(function (input) {
      input.addEventListener("input", function () {
        var rho = clamp(input.value, -0.95, 0.95, 0.5);
        document.querySelectorAll("[data-ovb-rho-out]").forEach(function (output) {
          output.textContent = formatNum(rho, 2);
        });
        document.querySelectorAll("[data-ovb-rho]").forEach(function (other) {
          if (other !== input) other.value = input.value;
        });
        var betaInput = setup.querySelector("[data-ovb-beta2]");
        updatePrediction(clamp(betaInput.value, -5, 5, current.beta2), rho);
      });
    });

    document.querySelectorAll("[data-ovb-beta2]").forEach(function (input) {
      input.addEventListener("input", function () {
        var beta2 = Number(input.value);
        if (!isFinite(beta2)) return;
        beta2 = Math.min(5, Math.max(-5, beta2));
        renderEquation(beta2);
        var rhoInput = setup.querySelector("[data-ovb-rho]");
        updatePrediction(beta2, clamp(rhoInput.value, -0.95, 0.95, current.rho));
      });
    });

    function onShow() {
      if (Reveal.getIndices().h !== resultsIndex) return;
      var next = pending();
      var changed = Math.abs(next.beta2 - current.beta2) > 1e-9 || Math.abs(next.rho - current.rho) > 1e-9;
      if (changed) apply(next.beta2, next.rho);
      else draw(current.result);
    }

    apply(1, 0.5);
    onShow();
    Reveal.on("slidechanged", onShow);
    window.addEventListener("resize", function () { draw(current.result); });
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { simulate: simulate, mean: mean };
  }

  if (typeof window !== "undefined") {
    window.startOvbSimulation = function () {
      if (window.__ovbStarted) return;
      window.__ovbStarted = true;
      mount();
    };
  }
})();
