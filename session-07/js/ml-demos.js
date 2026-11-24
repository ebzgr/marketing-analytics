/**
 * Session 7 interactive widgets (predictive analytics).
 *  - [data-overfit]: polynomial fits of increasing degree on a training sample vs. a new sample
 *    (bias-variance trade-off), with a train / new-sample error curve.
 *  - [data-sigmoid]: f(x) -> Pr(y = 1) through the logistic function.
 *  - [data-logloss]: log loss as a function of the predicted probability, for y = 1 or y = 0.
 *  - [data-cart]: greedy recursive partitioning on simulated click data, with a held-out sample.
 *  - [data-roc]: score distributions of clickers / non-clickers, threshold, confusion matrix, ROC and AUC.
 * Charts are inline SVG styled by CSS variables, so they follow the light / dark theme.
 */
(function () {
  var NS = "http://www.w3.org/2000/svg";

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function stat(value, label, warm) {
    var s = el("div", "stat" + (warm ? " warm" : ""));
    s.appendChild(el("span", "stat-value", value));
    s.appendChild(el("span", "stat-label", label));
    return s;
  }

  function svg(w, h, label) {
    var s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", "0 0 " + w + " " + h);
    s.setAttribute("class", "chart");
    s.setAttribute("role", "img");
    if (label) s.setAttribute("aria-label", label);
    return s;
  }

  function add(parent, tag, attrs, text) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    parent.appendChild(e);
    return e;
  }

  function scale(d0, d1, r0, r1) {
    return function (v) { return r0 + (v - d0) / (d1 - d0) * (r1 - r0); };
  }

  function pathFrom(pts) {
    return pts.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" ");
  }

  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function normal(r) {
    var u = Math.max(r(), 1e-9), v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /* Frame: axes + optional grid, returns plotting area helpers. */
  function frame(s, w, h, m, xd, yd, opts) {
    opts = opts || {};
    var X = scale(xd[0], xd[1], m.l, w - m.r);
    var Y = scale(yd[0], yd[1], h - m.b, m.t);
    (opts.yTicks || []).forEach(function (t) {
      add(s, "line", { class: "grid", x1: m.l, x2: w - m.r, y1: Y(t), y2: Y(t) });
      add(s, "text", { class: "tick", x: m.l - 6, y: Y(t) + 4, "text-anchor": "end" }, opts.yFmt ? opts.yFmt(t) : t);
    });
    (opts.xTicks || []).forEach(function (t) {
      add(s, "text", { class: "tick", x: X(t), y: h - m.b + 16, "text-anchor": "middle" }, opts.xFmt ? opts.xFmt(t) : t);
    });
    add(s, "line", { class: "axis", x1: m.l, x2: w - m.r, y1: h - m.b, y2: h - m.b });
    add(s, "line", { class: "axis", x1: m.l, x2: m.l, y1: m.t, y2: h - m.b });
    if (opts.xLabel) add(s, "text", { class: "lbl", x: w - m.r, y: h - 4, "text-anchor": "end" }, opts.xLabel);
    if (opts.yLabel) add(s, "text", { class: "lbl", x: m.l, y: m.t - 8, "text-anchor": "start" }, opts.yLabel);
    return { X: X, Y: Y };
  }

  /* ===== Widget 1: overfitting ===== */
  // A wavy true relationship: on average the best polynomial degree is around 6 (not 1 or 2).
  function truth(x) { return 1.6 * Math.sin(10 * x) * Math.exp(-1.5 * x) + 0.6; }

  function sample(r, n) {
    var pts = [];
    for (var i = 0; i < n; i++) {
      var x = (i + r()) / n;
      pts.push([x, truth(x) + 0.25 * normal(r)]);
    }
    return pts;
  }

  // Legendre basis on t = 2x - 1 keeps high-degree least squares well conditioned.
  function basis(x, d) {
    var t = 2 * x - 1, P = [1, t];
    for (var k = 1; k < d; k++) P.push(((2 * k + 1) * t * P[k] - k * P[k - 1]) / (k + 1));
    return P.slice(0, d + 1);
  }

  function solve(A, b) {
    var n = b.length, M = A.map(function (row, i) { return row.concat([b[i]]); });
    for (var c = 0; c < n; c++) {
      var p = c;
      for (var r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      var tmp = M[c]; M[c] = M[p]; M[p] = tmp;
      for (var r2 = 0; r2 < n; r2++) {
        if (r2 === c || !M[c][c]) continue;
        var f = M[r2][c] / M[c][c];
        for (var k = c; k <= n; k++) M[r2][k] -= f * M[c][k];
      }
    }
    return M.map(function (row, i) { return row[n] / (row[i] || 1); });
  }

  function polyFit(pts, d) {
    var n = d + 1, A = [], b = [];
    for (var i = 0; i < n; i++) { A.push(new Array(n).fill(0)); b.push(0); }
    pts.forEach(function (p) {
      var B = basis(p[0], d);
      for (var i = 0; i < n; i++) {
        b[i] += B[i] * p[1];
        for (var j = 0; j < n; j++) A[i][j] += B[i] * B[j];
      }
    });
    for (var k = 0; k < n; k++) A[k][k] += 1e-7;
    var beta = solve(A, b);
    return function (x) {
      var B = basis(x, d), s = 0;
      for (var i = 0; i < n; i++) s += beta[i] * B[i];
      return s;
    };
  }

  function mse(f, pts) {
    var s = 0;
    pts.forEach(function (p) { var e = p[1] - f(p[0]); s += e * e; });
    return s / pts.length;
  }

  function mountOverfit(root) {
    var box = root.querySelector("[data-of-chart]");
    var curveBox = root.querySelector("[data-of-curve]");
    var degIn = root.querySelector("[data-of-degree]");
    var degOut = root.querySelector("[data-of-degree-out]");
    var stats = root.querySelector("[data-of-stats]");
    var N = 20, DMAX = 20, Y0 = -0.9, Y1 = 2.7;
    var seed = 14;                 // seed 14: a first sample with a clear U-shape
    var train, test;

    // Expected error by complexity: average over many training samples, one big test sample.
    var curve = (function () {
      var r = rng(4242), big = [];
      for (var k = 0; k < 30; k++) big = big.concat(sample(r, N));
      var out = [];
      for (var d = 1; d <= DMAX; d++) out.push({ d: d, train: 0, test: 0 });
      var S = 40;
      for (var j = 0; j < S; j++) {
        var tr = sample(rng(7000 + j), N);
        for (var d2 = 1; d2 <= DMAX; d2++) {
          var f = polyFit(tr, d2);
          out[d2 - 1].train += mse(f, tr) / S;
          out[d2 - 1].test += Math.min(5, mse(f, big)) / S;
        }
      }
      return out;
    })();

    function draw() {
      train = sample(rng(seed * 31), N);
      test = sample(rng(seed * 17 + 5), N);
    }

    function fitPath(F, f) {
      var pts = [];
      for (var i = 0; i <= 240; i++) {
        var x = i / 240;
        pts.push([F.X(x), F.Y(clamp(f(x), Y0, Y1))]);
      }
      return pathFrom(pts);
    }

    function drawMain(d, f) {
      var w = 560, h = 340, m = { l: 34, r: 14, t: 18, b: 26 };
      var s = svg(w, h, "Training points, a new test sample, the true curve and the fitted curve");
      s.style.maxHeight = "470px";
      var F = frame(s, w, h, m, [0, 1], [Y0, Y1], { xLabel: "x", yLabel: "y" });
      var tp = [];
      for (var i = 0; i <= 200; i++) { var x = i / 200; tp.push([F.X(x), F.Y(truth(x))]); }
      add(s, "path", { class: "truth", d: pathFrom(tp) });
      test.forEach(function (p) { add(s, "circle", { class: "pt ghost new", cx: F.X(p[0]), cy: F.Y(clamp(p[1], Y0, Y1)), r: 6 }); });
      train.forEach(function (p) { add(s, "circle", { class: "pt", cx: F.X(p[0]), cy: F.Y(clamp(p[1], Y0, Y1)), r: 6 }); });
      add(s, "path", { class: "fit ink", d: fitPath(F, f) });
      box.innerHTML = "";
      box.appendChild(s);
    }

    function drawCurve(d) {
      var w = 300, h = 150, m = { l: 34, r: 10, t: 22, b: 24 };
      var s = svg(w, h, "Average error versus model complexity, on training data and on new samples");
      var ymax = 0.5;
      var F = frame(s, w, h, m, [1, DMAX], [0, ymax], {
        xTicks: [1, 5, 10, 15, 20], yTicks: [0, ymax / 2, ymax], yFmt: function (t) { return t.toFixed(2); },
        yLabel: "avg. MSE", xLabel: ""
      });
      add(s, "path", { class: "curve-b", d: pathFrom(curve.map(function (c) { return [F.X(c.d), F.Y(Math.min(c.train, ymax))]; })) });
      add(s, "path", { class: "curve-a", d: pathFrom(curve.map(function (c) { return [F.X(c.d), F.Y(Math.min(c.test, ymax))]; })) });
      add(s, "line", { class: "thresh", x1: F.X(d), x2: F.X(d), y1: m.t, y2: h - m.b });
      add(s, "text", { class: "tick", x: w - m.r, y: m.t - 8, "text-anchor": "end", style: "fill: var(--accent); font-weight: 700" }, "training");
      add(s, "text", { class: "tick", x: w - m.r - 62, y: m.t - 8, "text-anchor": "end", style: "fill: var(--accent-2); font-weight: 700" }, "new samples");
      curveBox.innerHTML = "";
      curveBox.appendChild(s);
    }

    function render() {
      var d = parseInt(degIn.value, 10);
      degOut.textContent = d;
      var f = polyFit(train, d);
      drawMain(d, f);
      drawCurve(d);
      stats.innerHTML = "";
      stats.appendChild(stat(mse(f, train).toFixed(3), "MSE on this training sample", true));
      var te = mse(f, test);
      stats.appendChild(stat(te > 9.99 ? "> 10" : te.toFixed(3), "MSE on a new sample"));
    }

    degIn.addEventListener("input", render);
    root.querySelector("[data-of-new]").addEventListener("click", function () {
      seed++;
      draw();
      render();
    });
    root.querySelector("[data-of-reset]").addEventListener("click", function () {
      seed = 14;
      draw();
      render();
    });

    draw();
    render();
  }

  /* ===== Logistic regression widgets ===== */
  // 14 users: x = past CTR (%), y = clicked (clickers oversampled for readability).
  var LR_X = [0.5, 1, 1.5, 2, 3, 3.5, 4, 5, 5.5, 6, 7, 8, 9.5, 11];
  var LR_Y = [0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 1];
  var OLS = { a: -0.0926, b: 0.1081 };            // OLS line on these points

  function sigma(z) { return 1 / (1 + Math.exp(-z)); }

  function avgLogLoss(b0, b1) {
    var s = 0;
    for (var i = 0; i < LR_X.length; i++) {
      var p = clamp(sigma(b0 + b1 * LR_X[i]), 1e-9, 1 - 1e-9);
      s -= LR_Y[i] ? Math.log(p) : Math.log(1 - p);
    }
    return s / LR_X.length;
  }

  function lrFrame(s, w, h, m) {
    var F = frame(s, w, h, m, [0, 12], [-0.2, 1.2], {
      xTicks: [0, 2, 4, 6, 8, 10, 12], yTicks: [0, 0.5, 1], xLabel: "past CTR x (%)", yLabel: "click?"
    });
    var bad = "fill: color-mix(in srgb, #dc2626 14%, transparent)";
    add(s, "rect", { x: m.l, y: F.Y(1.2), width: w - m.l - m.r, height: F.Y(1) - F.Y(1.2), style: bad });
    add(s, "rect", { x: m.l, y: F.Y(0), width: w - m.l - m.r, height: F.Y(-0.2) - F.Y(0), style: bad });
    return F;
  }

  function mountLrLine(root) {
    var box = root.querySelector("[data-lr-line-chart]");
    var btn = root.querySelector("[data-lr-line-btn]");   // optional toggle button
    var shown = true;
    function render() {
      var w = 440, h = 300, m = { l: 36, r: 14, t: 22, b: 30 };
      var s = svg(w, h, "Click data with an optional OLS line that goes below 0 and above 1");
      var F = lrFrame(s, w, h, m);
      add(s, "text", { class: "tick", x: w - m.r - 4, y: F.Y(1.2) + 13, "text-anchor": "end", style: "fill: #dc2626" }, "not a probability");
      LR_X.forEach(function (x, i) { add(s, "circle", { class: LR_Y[i] ? "pt" : "pt alt", cx: F.X(x), cy: F.Y(LR_Y[i]), r: 6 }); });
      if (shown) {
        add(s, "line", { class: "fit", x1: F.X(0), y1: F.Y(OLS.a), x2: F.X(12), y2: F.Y(OLS.a + OLS.b * 12) });
        [0.5, 11].forEach(function (x) {
          var yy = OLS.a + OLS.b * x;
          add(s, "circle", { class: "marker", cx: F.X(x), cy: F.Y(yy), r: 7 });
          add(s, "text", { class: "val", x: F.X(x) + (x > 6 ? -8 : 8), y: F.Y(yy) + (yy > 1 ? -10 : 20), "text-anchor": x > 6 ? "end" : "start" }, "ŷ = " + yy.toFixed(2));
        });
      }
      box.innerHTML = "";
      box.appendChild(s);
      if (btn) btn.textContent = shown ? "Hide the line" : "Fit a line (OLS)";
    }
    if (btn) btn.addEventListener("click", function () { shown = !shown; render(); });
    render();
  }

  function mountSigmoid(root) {
    var box = root.querySelector("[data-sig-chart]");
    var fIn = root.querySelector("[data-sig-f]");
    var fOut = root.querySelector("[data-sig-f-out]");
    var stats = root.querySelector("[data-sig-stats]");
    function render() {
      var z = parseFloat(fIn.value);
      fOut.textContent = z.toFixed(1);
      var w = 380, h = 220, m = { l: 36, r: 12, t: 20, b: 26 };
      var s = svg(w, h, "Sigmoid curve mapping the score z to the probability of a click");
      var F = frame(s, w, h, m, [-6, 6], [0, 1], { xTicks: [-6, -3, 0, 3, 6], yTicks: [0, 0.5, 1], yLabel: "p̂ = Pr(click)", xLabel: "score z" });
      var pts = [];
      for (var i = 0; i <= 120; i++) { var x = -6 + i / 10; pts.push([F.X(x), F.Y(sigma(x))]); }
      add(s, "path", { class: "curve-a", d: pathFrom(pts) });
      var p = sigma(z);
      add(s, "line", { class: "diag", x1: F.X(z), x2: F.X(z), y1: F.Y(0), y2: F.Y(p) });
      add(s, "line", { class: "diag", x1: F.X(-6), x2: F.X(z), y1: F.Y(p), y2: F.Y(p) });
      add(s, "circle", { class: "marker", cx: F.X(z), cy: F.Y(p), r: 7 });
      box.innerHTML = "";
      box.appendChild(s);
      stats.innerHTML = "";
      stats.appendChild(stat(p.toFixed(3), "p̂ = Pr(click)"));
      stats.appendChild(stat((1 - p).toFixed(3), "1 − p̂ = Pr(no click)", true));
    }
    fIn.addEventListener("input", render);
    render();
  }

  function mountLogloss(root) {
    var box = root.querySelector("[data-ll-chart]");
    var pIn = root.querySelector("[data-ll-p]");
    var pOut = root.querySelector("[data-ll-p-out]");
    var stats = root.querySelector("[data-ll-stats]");
    var btns = root.querySelectorAll("[data-ll-y]");
    var y = 1;
    function ll(p) { return y === 1 ? -Math.log(p) : -Math.log(1 - p); }
    function sq(p) { return (y - p) * (y - p); }
    function render() {
      var p = parseFloat(pIn.value);
      pOut.textContent = p.toFixed(2);
      var w = 420, h = 240, m = { l: 36, r: 14, t: 22, b: 30 };
      var s = svg(w, h, "Log loss and squared loss as a function of the predicted probability");
      var F = frame(s, w, h, m, [0, 1], [0, 5], { xTicks: [0, 0.25, 0.5, 0.75, 1], yTicks: [0, 1, 2, 3, 4, 5], xLabel: "predicted p̂", yLabel: "loss when y = " + y });
      var a = [], b = [];
      for (var i = 1; i < 200; i++) { var q = i / 200; a.push([F.X(q), F.Y(Math.min(5, ll(q)))]); b.push([F.X(q), F.Y(sq(q))]); }
      add(s, "path", { class: "curve-a", d: pathFrom(a) });
      add(s, "path", { class: "curve-b", d: pathFrom(b), style: "stroke-dasharray: 6 5" });
      add(s, "text", { class: "tick", x: w - m.r, y: m.t - 6, "text-anchor": "end", style: "fill: var(--accent-2); font-weight: 700" }, "log loss");
      add(s, "text", { class: "tick", x: w - m.r - 60, y: m.t - 6, "text-anchor": "end", style: "fill: var(--accent); font-weight: 700" }, "squared loss (dashed)");
      var L = ll(p);
      add(s, "circle", { class: "marker", cx: F.X(p), cy: F.Y(Math.min(5, L)), r: 7 });
      add(s, "circle", { class: "marker", cx: F.X(p), cy: F.Y(sq(p)), r: 5, style: "fill: var(--bg-soft); stroke: var(--accent)" });
      box.innerHTML = "";
      box.appendChild(s);
      stats.innerHTML = "";
      stats.appendChild(stat(L.toFixed(3), "log loss ℓ"));
      stats.appendChild(stat(sq(p).toFixed(3), "squared loss", true));
    }
    Array.prototype.forEach.call(btns, function (bt) {
      bt.addEventListener("click", function () {
        y = parseInt(bt.getAttribute("data-ll-y"), 10);
        Array.prototype.forEach.call(btns, function (o) { o.classList.toggle("on", o === bt); o.classList.toggle("ghost", o !== bt); });
        render();
      });
    });
    pIn.addEventListener("input", render);
    render();
  }

  function mountLrFit(root) {
    var box = root.querySelector("[data-lr-fit-chart]");
    var b0In = root.querySelector("[data-lr-b0]");
    var b1In = root.querySelector("[data-lr-b1]");
    var stats = root.querySelector("[data-lr-stats]");
    var b0 = 0, b1 = 0, best = Infinity, anim = null, iter = 0;

    function render() {
      root.querySelector("[data-lr-b0-out]").textContent = b0.toFixed(2);
      root.querySelector("[data-lr-b1-out]").textContent = b1.toFixed(2);
      var w = 440, h = 250, m = { l: 36, r: 14, t: 22, b: 30 };
      var s = svg(w, h, "Click data with the logistic curve for the chosen coefficients");
      var F = lrFrame(s, w, h, m);
      LR_X.forEach(function (x, i) {
        var p = sigma(b0 + b1 * x);
        var l = LR_Y[i] ? -Math.log(Math.max(p, 1e-9)) : -Math.log(Math.max(1 - p, 1e-9));
        add(s, "line", { x1: F.X(x), x2: F.X(x), y1: F.Y(LR_Y[i]), y2: F.Y(p), style: "stroke: var(--accent); stroke-width: " + Math.min(7, 1 + 2.2 * l).toFixed(1) + "; opacity: 0.55" });
      });
      var pts = [];
      for (var k = 0; k <= 120; k++) { var x = 12 * k / 120; pts.push([F.X(x), F.Y(sigma(b0 + b1 * x))]); }
      add(s, "path", { class: "fit", d: pathFrom(pts) });
      LR_X.forEach(function (x, i) { add(s, "circle", { class: LR_Y[i] ? "pt" : "pt alt", cx: F.X(x), cy: F.Y(LR_Y[i]), r: 6 }); });
      box.innerHTML = "";
      box.appendChild(s);
      var L = avgLogLoss(b0, b1);
      best = Math.min(best, L);
      stats.innerHTML = "";
      stats.appendChild(stat(L.toFixed(3), "L(β): average log loss" + (iter ? " · step " + iter : "")));
      stats.appendChild(stat(best.toFixed(3), "best so far (average-only: 0.683, optimum: 0.403)", true));
    }

    function stop() { if (anim) clearTimeout(anim); anim = null; }

    function fromSliders() { stop(); iter = 0; b0 = parseFloat(b0In.value); b1 = parseFloat(b1In.value); render(); }
    b0In.addEventListener("input", fromSliders);
    b1In.addEventListener("input", fromSliders);

    root.querySelector("[data-lr-go]").addEventListener("click", function () {
      stop();
      var n = LR_X.length, prev = Infinity;
      function frameStep() {
        for (var k = 0; k < 20; k++) {
          var g0 = 0, g1 = 0;
          for (var i = 0; i < n; i++) { var e = sigma(b0 + b1 * LR_X[i]) - LR_Y[i]; g0 += e; g1 += e * LR_X[i]; }
          b0 -= 0.1 * g0 / n;
          b1 -= 0.1 * g1 / n;
          iter++;
        }
        b0In.value = b0;
        b1In.value = b1;
        render();
        var L = avgLogLoss(b0, b1);
        if (iter < 2000 && Math.abs(prev - L) > 1e-7) { prev = L; anim = setTimeout(frameStep, 30); } else { anim = null; }
      }
      anim = setTimeout(frameStep, 0);
    });
    root.querySelector("[data-lr-reset]").addEventListener("click", function () {
      stop(); iter = 0; b0 = 0; b1 = 0; best = Infinity; b0In.value = 0; b1In.value = 0; render();
    });
    render();
  }

  /* ===== Widget 4: recursive partitioning ===== */
  function clickProb(x1, x2) {
    // x1: user's past CTR on this ad (behavioral), x2: ad's past CTR in this app and hour (contextual)
    var p = 0.06;
    if (x1 > 0.6 && x2 > 0.45) p = 0.75;
    else if (x1 > 0.6) p = 0.35;
    else if (x2 > 0.75) p = 0.3;
    return p;
  }

  function cartData(seed, n) {
    var r = rng(seed), pts = [];
    for (var i = 0; i < n; i++) {
      var a = r(), b = r();
      pts.push({ x: [a, b], y: r() < clickProb(a, b) ? 1 : 0 });
    }
    return pts;
  }

  function mountCart(root) {
    var box = root.querySelector("[data-cart-chart]");
    var kIn = root.querySelector("[data-cart-k]");
    var kOut = root.querySelector("[data-cart-k-out]");
    var stats = root.querySelector("[data-cart-stats]");
    var note = root.querySelector("[data-cart-note]");
    var stepBtn = root.querySelector("[data-cart-step]");
    var growBtn = root.querySelector("[data-cart-grow]");
    var train = cartData(42, 260);
    var test = cartData(4242, 2000);
    var leaves, done;

    function makeLeaf(idx, lo, hi) {
      var s = 0;
      idx.forEach(function (i) { s += train[i].y; });
      return { idx: idx, lo: lo, hi: hi, n: idx.length, mean: idx.length ? s / idx.length : 0 };
    }

    function sse(n, s) { return n ? s - s * s / n : 0; }

    function bestSplit(leaf, K) {
      var best = null;
      [0, 1].forEach(function (ax) {
        var idx = leaf.idx.slice().sort(function (a, b) { return train[a].x[ax] - train[b].x[ax]; });
        var tot = 0;
        idx.forEach(function (i) { tot += train[i].y; });
        var base = sse(idx.length, tot), left = 0;
        for (var k = 0; k < idx.length - 1; k++) {
          left += train[idx[k]].y;
          var nl = k + 1, nr = idx.length - nl;
          if (nl < K || nr < K) continue;
          var v0 = train[idx[k]].x[ax], v1 = train[idx[k + 1]].x[ax];
          if (v0 === v1) continue;
          var gain = base - sse(nl, left) - sse(nr, tot - left);
          if (!best || gain > best.gain) best = { gain: gain, ax: ax, t: (v0 + v1) / 2 };
        }
      });
      return best;
    }

    function step() {
      if (done) return false;
      var K = parseInt(kIn.value, 10), pick = null, which = -1;
      leaves.forEach(function (l, i) {
        var b = bestSplit(l, K);
        if (b && b.gain > 1e-9 && (!pick || b.gain > pick.gain)) { pick = b; which = i; }
      });
      if (!pick) { done = true; return false; }
      var l = leaves[which];
      var L = [], R = [];
      l.idx.forEach(function (i) { (train[i].x[pick.ax] <= pick.t ? L : R).push(i); });
      var loL = l.lo.slice(), hiL = l.hi.slice(), loR = l.lo.slice(), hiR = l.hi.slice();
      hiL[pick.ax] = pick.t;
      loR[pick.ax] = pick.t;
      leaves.splice(which, 1, makeLeaf(L, loL, hiL), makeLeaf(R, loR, hiR));
      return true;
    }

    function predict(x) {
      for (var i = 0; i < leaves.length; i++) {
        var l = leaves[i];
        if (x[0] >= l.lo[0] && x[0] <= l.hi[0] && x[1] >= l.lo[1] && x[1] <= l.hi[1]) return l.mean;
      }
      return 0;
    }

    function logloss(pts, f) {
      var s = 0;
      pts.forEach(function (p) {
        var q = clamp(f(p.x), 0.01, 0.99);
        s -= p.y ? Math.log(q) : Math.log(1 - q);
      });
      return s / pts.length;
    }

    function render() {
      var w = 400, h = 340, m = { l: 34, r: 10, t: 14, b: 30 };
      var s = svg(w, h, "Click data with tree partitions shaded by predicted click rate");
      s.style.maxHeight = "490px";
      var X = scale(0, 1, m.l, w - m.r), Y = scale(0, 1, h - m.b, m.t);
      leaves.forEach(function (l) {
        add(s, "rect", {
          class: "region",
          x: X(l.lo[0]), y: Y(l.hi[1]), width: X(l.hi[0]) - X(l.lo[0]), height: Y(l.lo[1]) - Y(l.hi[1]),
          style: "fill: color-mix(in srgb, var(--accent-2) " + Math.round(8 + 70 * l.mean) + "%, var(--bg-soft))"
        });
      });
      train.forEach(function (p) {
        add(s, "circle", { class: p.y ? "pt" : "pt ghost", cx: X(p.x[0]), cy: Y(p.x[1]), r: p.y ? 4.5 : 3.2 });
      });
      leaves.forEach(function (l) {
        var bw = X(l.hi[0]) - X(l.lo[0]), bh = Y(l.lo[1]) - Y(l.hi[1]);
        if (bw > 44 && bh > 22) {
          add(s, "text", { class: "leaf-lbl", x: X((l.lo[0] + l.hi[0]) / 2), y: Y((l.lo[1] + l.hi[1]) / 2) + 5, "text-anchor": "middle" }, Math.round(100 * l.mean) + "%");
        }
      });
      add(s, "line", { class: "axis", x1: m.l, x2: w - m.r, y1: h - m.b, y2: h - m.b });
      add(s, "line", { class: "axis", x1: m.l, x2: m.l, y1: m.t, y2: h - m.b });
      add(s, "text", { class: "lbl", x: w - m.r, y: h - 8, "text-anchor": "end" }, "user’s past CTR on this ad (behavioral) →");
      add(s, "text", { class: "lbl", x: 14, y: h - m.b, transform: "rotate(-90 14 " + (h - m.b) + ")" }, "ad’s past CTR in this app (contextual) →");
      box.innerHTML = "";
      box.appendChild(s);

      var trL = logloss(train, function (x) { return predict(x); });
      var teL = logloss(test, function (x) { return predict(x); });
      stats.innerHTML = "";
      stats.appendChild(stat(String(leaves.length), "leaves"));
      stats.appendChild(stat(trL.toFixed(3) + " / " + teL.toFixed(3), "log loss: training / new data", true));
      stepBtn.disabled = done;
      growBtn.disabled = done;
      note.textContent = done
        ? "Stopped: no split leaves at least K users on each side. Try a smaller K and compare the loss on new data."
        : "Dots: users (filled orange = clicked). Shading and labels: predicted CTR in each leaf.";
    }

    function reset() {
      var all = train.map(function (_, i) { return i; });
      leaves = [makeLeaf(all, [0, 0], [1, 1])];
      done = false;
      render();
    }

    kIn.addEventListener("input", function () { kOut.textContent = kIn.value; reset(); });
    stepBtn.addEventListener("click", function () { step(); render(); });
    growBtn.addEventListener("click", function () { while (step()) { /* grow */ } done = true; render(); });
    root.querySelector("[data-cart-reset]").addEventListener("click", reset);
    reset();
  }

  /* ===== Widget 5: ROC / AUC ===== */
  function erf(x) {
    var s = x < 0 ? -1 : 1;
    x = Math.abs(x);
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }
  function Phi(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }
  function phi(z) { return Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI); }
  function logit(p) { return Math.log(p / (1 - p)); }

  function mountRoc(root) {
    var distBox = root.querySelector("[data-roc-dist]");
    var curveBox = root.querySelector("[data-roc-curve]");
    var cmBox = root.querySelector("[data-roc-cm]");
    var tIn = root.querySelector("[data-roc-t]");
    var qIn = root.querySelector("[data-roc-q]");
    var P = 500, N = 500;

    function rates(zt, q) {
      return { tpr: 1 - Phi(zt - q / 2), fpr: 1 - Phi(zt + q / 2) };
    }

    function render() {
      var t = clamp(parseFloat(tIn.value), 0.005, 0.995);
      var q = parseFloat(qIn.value);
      root.querySelector("[data-roc-t-out]").textContent = parseFloat(tIn.value).toFixed(2);
      root.querySelector("[data-roc-q-out]").textContent = q.toFixed(1);
      var zt = logit(t);
      var r = rates(zt, q);
      var auc = Phi(q / Math.SQRT2);

      // Distributions (latent score axis, labelled as probabilities)
      var w = 440, h = 230, m = { l: 14, r: 14, t: 22, b: 30 };
      var s = svg(w, h, "Score distributions of clickers and non-clickers with the classification threshold");
      var F = frame(s, w, h, m, [-4.5, 4.5], [0, 0.45], {
        xTicks: [0.02, 0.1, 0.3, 0.5, 0.7, 0.9, 0.98].map(logit), xFmt: function (z) { return (1 / (1 + Math.exp(-z))).toFixed(2); },
        xLabel: "predicted Pr(click)"
      });
      function density(mu, cls, from, to) {
        var pts = [[F.X(from), F.Y(0)]];
        for (var i = 0; i <= 120; i++) {
          var z = from + (to - from) * i / 120;
          pts.push([F.X(z), F.Y(phi(z - mu))]);
        }
        pts.push([F.X(to), F.Y(0)]);
        add(s, "path", { class: cls, d: pathFrom(pts) + " Z" });
      }
      var zc = clamp(zt, -4.5, 4.5);
      density(-q / 2, "area-b", zc, 4.5);   // false positives
      density(q / 2, "area-a", zc, 4.5);    // true positives
      var line = function (mu, cls) {
        var pts = [];
        for (var i = 0; i <= 160; i++) { var z = -4.5 + 9 * i / 160; pts.push([F.X(z), F.Y(phi(z - mu))]); }
        add(s, "path", { class: cls, d: pathFrom(pts) });
      };
      line(-q / 2, "curve-b");
      line(q / 2, "curve-a");
      add(s, "line", { class: "thresh", x1: F.X(zc), x2: F.X(zc), y1: m.t - 6, y2: h - m.b });
      add(s, "text", { class: "tick", x: m.l + 4, y: m.t - 6, style: "fill: var(--accent); font-weight: 700" }, "non-clickers");
      add(s, "text", { class: "tick", x: w - m.r - 4, y: m.t - 6, "text-anchor": "end", style: "fill: var(--accent-2); font-weight: 700" }, "clickers");
      distBox.innerHTML = "";
      distBox.appendChild(s);

      // ROC curve
      var w2 = 440, h2 = 230, m2 = { l: 40, r: 120, t: 14, b: 30 };
      var s2 = svg(w2, h2, "ROC curve with the current threshold marked");
      var G = frame(s2, w2, h2, m2, [0, 1], [0, 1], {
        xTicks: [0, 0.5, 1], yTicks: [0, 0.5, 1], xLabel: "FPR", yLabel: "TPR"
      });
      var pts = [[G.X(0), G.Y(0)]];
      for (var i = 0; i <= 160; i++) {
        var z = 6 - 12 * i / 160, rr = rates(z, q);
        pts.push([G.X(rr.fpr), G.Y(rr.tpr)]);
      }
      pts.push([G.X(1), G.Y(1)]);
      add(s2, "path", { class: "area-a", d: pathFrom(pts) + " L" + G.X(1) + " " + G.Y(0) + " Z" });
      add(s2, "path", { class: "curve-a", d: pathFrom(pts) });
      add(s2, "line", { class: "diag", x1: G.X(0), y1: G.Y(0), x2: G.X(1), y2: G.Y(1) });
      add(s2, "circle", { class: "marker", cx: G.X(r.fpr), cy: G.Y(r.tpr), r: 7 });
      add(s2, "text", { class: "val", x: w2 - m2.r + 14, y: 60 }, "AUC");
      add(s2, "text", { class: "val", x: w2 - m2.r + 14, y: 92, style: "font-size: 28px; fill: var(--accent-2)" }, auc.toFixed(2));
      add(s2, "text", { class: "tick", x: w2 - m2.r + 14, y: 130 }, "TPR " + r.tpr.toFixed(2));
      add(s2, "text", { class: "tick", x: w2 - m2.r + 14, y: 148 }, "FPR " + r.fpr.toFixed(2));
      curveBox.innerHTML = "";
      curveBox.appendChild(s2);

      // Confusion matrix (500 clickers, 500 non-clickers)
      var TP = Math.round(P * r.tpr), FN = P - TP, FP = Math.round(N * r.fpr), TN = N - FP;
      cmBox.innerHTML =
        '<table class="cm"><thead><tr><th>500 + 500 users</th><th>Predicted click</th><th>Predicted no click</th></tr></thead><tbody>' +
        '<tr><th>Clicked (P)</th><td class="ok">TP = ' + TP + '</td><td class="bad">FN = ' + FN + '</td></tr>' +
        '<tr><th>Did not click (N)</th><td class="bad">FP = ' + FP + '</td><td class="ok">TN = ' + TN + '</td></tr>' +
        '</tbody></table>';
    }

    tIn.addEventListener("input", render);
    qIn.addEventListener("input", render);
    render();
  }

  /* ===== How flexible should f be? Three fits on the same training sample ===== */
  function mountFlex(root) {
    var box = root.querySelector("[data-flex-charts]");
    var train = sample(rng(14 * 31), 20);   // the same first sample as the next slide
    [
      { d: 1, name: "Too simple", sub: "straight line (degree 1)" },
      { d: 6, name: "Flexible", sub: "degree-6 polynomial" },
      { d: 15, name: "Very flexible", sub: "degree-15 polynomial" }
    ].forEach(function (c) {
      var f = polyFit(train, c.d);
      var w = 320, h = 160, m = { l: 14, r: 10, t: 34, b: 10 };
      var s = svg(w, h, c.name + " fit on the training data");
      var X = scale(0, 1, m.l, w - m.r), Y = scale(-0.9, 2.7, h - m.b, m.t);
      add(s, "line", { class: "axis", x1: m.l, x2: w - m.r, y1: h - m.b, y2: h - m.b });
      add(s, "line", { class: "axis", x1: m.l, x2: m.l, y1: m.t, y2: h - m.b });
      var tp = [], fp = [];
      for (var i = 0; i <= 200; i++) {
        var x = i / 200;
        tp.push([X(x), Y(truth(x))]);
        fp.push([X(x), Y(clamp(f(x), -0.9, 2.7))]);
      }
      add(s, "path", { class: "truth", d: pathFrom(tp) });
      train.forEach(function (p) { add(s, "circle", { class: "pt", cx: X(p[0]), cy: Y(clamp(p[1], -0.9, 2.7)), r: 4.5 }); });
      add(s, "path", { class: "fit ink", d: pathFrom(fp) });
      add(s, "text", { class: "val", x: m.l, y: 16 }, c.name);
      add(s, "text", { class: "tick", x: m.l, y: 29 }, c.sub);
      add(s, "text", { class: "val", x: w - m.r, y: 16, "text-anchor": "end", style: "fill: var(--accent)" }, "training MSE " + mse(f, train).toFixed(3));
      box.appendChild(s);
    });
  }

  /* ===== Boosting, step by step (regression trees on residuals) ===== */
  function boostTruth(h) {
    return 1.0 + 0.5 * Math.sin(2 * Math.PI * (h - 15) / 24) + 0.9 * Math.exp(-Math.pow((h - 21) / 1.5, 2));
  }

  function boostSample(r, n) {
    var pts = [];
    for (var i = 0; i < n; i++) {
      var x = 24 * r();
      pts.push([x, boostTruth(x) + 0.25 * normal(r)]);
    }
    return pts;
  }

  // Greedy regression tree on (x, r) pairs: depth 2 = at most 4 leaves.
  function fitTree(pts, depth, minLeaf) {
    var n = pts.length, sum = 0;
    pts.forEach(function (p) { sum += p[1]; });
    var leaf = { value: n ? sum / n : 0 };
    if (depth === 0 || n < 2 * minLeaf) return leaf;
    var sorted = pts.slice().sort(function (a, b) { return a[0] - b[0]; });
    var best = null, left = 0;
    for (var k = 0; k < n - 1; k++) {
      left += sorted[k][1];
      var nl = k + 1, nr = n - nl;
      if (nl < minLeaf || nr < minLeaf || sorted[k][0] === sorted[k + 1][0]) continue;
      var gain = left * left / nl + (sum - left) * (sum - left) / nr;   // = SSE reduction + const
      if (!best || gain > best.gain) best = { gain: gain, t: (sorted[k][0] + sorted[k + 1][0]) / 2 };
    }
    if (!best) return leaf;
    var L = [], R = [];
    sorted.forEach(function (p) { (p[0] <= best.t ? L : R).push(p); });
    return { t: best.t, left: fitTree(L, depth - 1, minLeaf), right: fitTree(R, depth - 1, minLeaf) };
  }

  function treePredict(tree, x) {
    while (tree.t != null) tree = x <= tree.t ? tree.left : tree.right;
    return tree.value;
  }

  function mountBoost(root) {
    var modelBox = root.querySelector("[data-boost-model]");
    var residBox = root.querySelector("[data-boost-resid]");
    var stats = root.querySelector("[data-boost-stats]");
    var title = root.querySelector("[data-boost-title]");
    var etaIn = root.querySelector("[data-boost-eta]");
    var train = boostSample(rng(77), 70);
    var test = boostSample(rng(78), 600);
    var base = 0, trees = [], lastTree = null, eta = 0.5;
    train.forEach(function (p) { base += p[1] / train.length; });

    function F(x, k) {
      var v = base, upto = k == null ? trees.length : k;
      for (var i = 0; i < upto; i++) v += trees[i].eta * treePredict(trees[i].tree, x);
      return v;
    }

    function mseOf(pts) {
      var s = 0;
      pts.forEach(function (p) { var e = p[1] - F(p[0]); s += e * e; });
      return s / pts.length;
    }

    function curve(fn, X, Y) {
      var pts = [];
      for (var i = 0; i <= 480; i++) { var x = 24 * i / 480; pts.push([X(x), Y(fn(x))]); }
      return pathFrom(pts);
    }

    function render() {
      var k = trees.length;
      var w = 440, h = 230, m = { l: 34, r: 12, t: 14, b: 28 };

      // Left: data and the current model
      var s = svg(w, h, "Training data and the boosted model after " + k + " trees");
      var G = frame(s, w, h, m, [0, 24], [0, 2.8], { xTicks: [0, 6, 12, 18, 24], yTicks: [0, 1, 2], xLabel: "hour of the day", yLabel: "" });
      train.forEach(function (p) { add(s, "circle", { class: "pt", cx: G.X(p[0]), cy: G.Y(clamp(p[1], 0, 2.8)), r: 4 }); });
      if (k > 0) add(s, "path", { class: "fit ink", d: curve(function (x) { return F(x, k - 1); }, G.X, G.Y), style: "opacity: 0.25; stroke-width: 2" });
      add(s, "path", { class: "fit ink", d: curve(function (x) { return F(x); }, G.X, G.Y) });
      modelBox.innerHTML = "";
      modelBox.appendChild(s);

      // Right: residuals before the last tree, and that tree
      var s2 = svg(w, h, "Residuals and the tree fitted to them");
      var H = frame(s2, w, h, m, [0, 24], [-1.5, 1.5], { xTicks: [0, 6, 12, 18, 24], yTicks: [-1, 0, 1], xLabel: "hour of the day", yLabel: "" });
      add(s2, "line", { class: "diag", x1: m.l, x2: w - m.r, y1: H.Y(0), y2: H.Y(0) });
      var prevK = lastTree ? k - 1 : k;
      train.forEach(function (p) {
        var r = p[1] - F(p[0], prevK);
        add(s2, "circle", { class: "pt", cx: H.X(p[0]), cy: H.Y(clamp(r, -1.5, 1.5)), r: 4 });
      });
      if (lastTree) add(s2, "path", { class: "curve-a", style: "stroke-width: 3.5", d: curve(function (x) { return treePredict(lastTree, x); }, H.X, H.Y) });
      residBox.innerHTML = "";
      residBox.appendChild(s2);

      title.textContent = k === 0 ? "(start: the average)" : "(average + " + k + (k === 1 ? " tree)" : " trees)");
      stats.innerHTML = "";
      stats.appendChild(stat(String(k), "trees added"));
      stats.appendChild(stat(mseOf(train).toFixed(3), "MSE on training data", true));
      stats.appendChild(stat(mseOf(test).toFixed(3), "MSE on new data"));
    }

    function addTree() {
      var resid = train.map(function (p) { return [p[0], p[1] - F(p[0])]; });
      lastTree = fitTree(resid, 2, 3);
      trees.push({ tree: lastTree, eta: eta });
    }

    root.querySelector("[data-boost-step]").addEventListener("click", function () { addTree(); render(); });
    root.querySelector("[data-boost-ten]").addEventListener("click", function () { for (var i = 0; i < 10; i++) addTree(); render(); });
    root.querySelector("[data-boost-reset]").addEventListener("click", function () { trees = []; lastTree = null; render(); });
    etaIn.addEventListener("input", function () {
      eta = parseFloat(etaIn.value);
      root.querySelector("[data-boost-eta-out]").textContent = eta.toFixed(1);
    });
    render();
  }

  window.startMlDemos = function () {
    var map = [
      ["[data-flex]", mountFlex],
      ["[data-overfit]", mountOverfit],
      ["[data-boost]", mountBoost],
      ["[data-lr-line]", mountLrLine],
      ["[data-sigmoid]", mountSigmoid],
      ["[data-lr-fit]", mountLrFit],
      ["[data-logloss]", mountLogloss],
      ["[data-cart]", mountCart],
      ["[data-roc]", mountRoc]
    ];
    map.forEach(function (m) {
      var node = document.querySelector(m[0]);
      if (node) m[1](node);
    });
  };
})();
