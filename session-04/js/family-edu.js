/**
 * Rich vs poor families: education–income scatter with a pooled OLS line
 * and two group-specific regressions (dummy / separate-intercept idea).
 */
(function () {
  var N_EACH = 55;
  var SEED = 20251005;
  var COL = {
    poor: "#0f766e",
    rich: "#b45309",
    pooled: "#1e293b",
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

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function ols(points) {
    var n = points.length;
    var sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (var i = 0; i < n; i++) {
      sx += points[i].x;
      sy += points[i].y;
      sxx += points[i].x * points[i].x;
      sxy += points[i].x * points[i].y;
    }
    var det = n * sxx - sx * sx;
    var b = (n * sxy - sx * sy) / det;
    var a = (sy - b * sx) / n;
    return { a: a, b: b };
  }

  /** Overlapping clouds: rich higher on both axes, not cleanly separated. */
  function makeData() {
    var rng = mulberry32(SEED);
    var poor = [];
    var rich = [];
    for (var i = 0; i < N_EACH; i++) {
      var eduP = clamp(10.5 + 2.1 * randn(rng), 6, 18);
      var incP = 18 + 1.6 * eduP + 5.5 * randn(rng);
      poor.push({ x: eduP, y: Math.max(8, incP) });

      var eduR = clamp(13.8 + 2.1 * randn(rng), 8, 20);
      var incR = 32 + 1.6 * eduR + 5.5 * randn(rng);
      rich.push({ x: eduR, y: Math.max(12, incR) });
    }
    return { poor: poor, rich: rich, all: poor.concat(rich) };
  }

  function draw(canvas, data) {
    var cssW = canvas.clientWidth;
    var cssH = canvas.clientHeight;
    if (cssW < 40 || cssH < 40) return;

    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cssW, cssH);

    var pad = { l: 52, r: 14, t: 18, b: 42 };
    var plotW = cssW - pad.l - pad.r;
    var plotH = cssH - pad.t - pad.b;

    var xMin = 6, xMax = 20;
    var yMin = 10, yMax = 85;
    data.all.forEach(function (p) {
      if (p.y > yMax) yMax = p.y;
      if (p.y < yMin) yMin = p.y;
    });
    yMin = Math.floor((yMin - 4) / 5) * 5;
    yMax = Math.ceil((yMax + 4) / 5) * 5;

    function X(x) { return pad.l + ((x - xMin) / (xMax - xMin)) * plotW; }
    function Y(y) { return pad.t + plotH - ((y - yMin) / (yMax - yMin)) * plotH; }

    ctx.strokeStyle = COL.grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = COL.muted;
    ctx.font = "600 11px 'Source Sans 3', sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (var yt = yMin; yt <= yMax; yt += 10) {
      var py = Y(yt);
      ctx.beginPath();
      ctx.moveTo(pad.l, py);
      ctx.lineTo(pad.l + plotW, py);
      ctx.stroke();
      ctx.fillText(String(yt), pad.l - 6, py);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (var xt = 8; xt <= 18; xt += 2) {
      var px = X(xt);
      ctx.beginPath();
      ctx.moveTo(px, pad.t);
      ctx.lineTo(px, pad.t + plotH);
      ctx.stroke();
      ctx.fillText(String(xt), px, pad.t + plotH + 6);
    }

    ctx.fillStyle = COL.text;
    ctx.font = "700 12px 'Source Sans 3', sans-serif";
    ctx.fillText("Years of education", pad.l + plotW / 2, cssH - 14);
    ctx.save();
    ctx.translate(14, pad.t + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("Income", 0, 0);
    ctx.restore();

    function dots(points, color) {
      ctx.fillStyle = color;
      for (var i = 0; i < points.length; i++) {
        ctx.beginPath();
        ctx.arc(X(points[i].x), Y(points[i].y), 3.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    dots(data.poor, COL.poor);
    dots(data.rich, COL.rich);

    var pooled = ols(data.all);
    var fitPoor = ols(data.poor);
    var fitRich = ols(data.rich);

    function line(fit, color, dash, width) {
      var x0 = xMin + 0.4;
      var x1 = xMax - 0.4;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(X(x0), Y(fit.a + fit.b * x0));
      ctx.lineTo(X(x1), Y(fit.a + fit.b * x1));
      ctx.stroke();
      ctx.restore();
    }

    line(pooled, COL.pooled, [6, 4], 2.4);
    line(fitPoor, COL.poor, [], 2.2);
    line(fitRich, COL.rich, [], 2.2);

    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 1;
    ctx.strokeRect(pad.l, pad.t, plotW, plotH);

    var legend = [
      { label: "Poor families", color: COL.poor, kind: "dot" },
      { label: "Rich families", color: COL.rich, kind: "dot" },
      { label: "Pooled regression", color: COL.pooled, kind: "dash" },
      { label: "Separate regressions", color: COL.poor, kind: "solid" },
    ];
    var lx = pad.l + 10;
    var ly = pad.t + 10;
    ctx.font = "600 11px 'Source Sans 3', sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    legend.forEach(function (item, idx) {
      var y = ly + idx * 16;
      if (item.kind === "dot") {
        ctx.fillStyle = item.color;
        ctx.beginPath();
        ctx.arc(lx + 5, y, 3.2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = item.kind === "dash" ? COL.pooled : COL.rich;
        if (item.kind === "solid") {
          ctx.beginPath();
          ctx.strokeStyle = COL.poor;
          ctx.lineWidth = 2;
          ctx.moveTo(lx, y);
          ctx.lineTo(lx + 8, y);
          ctx.stroke();
          ctx.beginPath();
          ctx.strokeStyle = COL.rich;
          ctx.moveTo(lx + 8, y);
          ctx.lineTo(lx + 16, y);
          ctx.stroke();
        } else {
          ctx.setLineDash([4, 3]);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(lx, y);
          ctx.lineTo(lx + 16, y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      ctx.fillStyle = COL.text;
      ctx.fillText(item.label, lx + 22, y);
    });

    canvas._fit = { pooled: pooled, poor: fitPoor, rich: fitRich };
  }

  function mount() {
    var section = document.querySelector("[data-family-edu]");
    if (!section || typeof Reveal === "undefined") return;
    var canvas = section.querySelector("[data-family-plot]");
    if (!canvas) return;

    var data = makeData();
    var sections = Array.prototype.slice.call(document.querySelectorAll(".reveal .slides > section"));
    var index = sections.indexOf(section);

    function redraw() {
      draw(canvas, data);
      var fit = canvas._fit;
      var note = section.querySelector("[data-family-note]");
      if (note && fit) {
        note.textContent =
          "Pooled slope \u2248 " + fit.pooled.b.toFixed(2) +
          "  ·  poor \u2248 " + fit.poor.b.toFixed(2) +
          "  ·  rich \u2248 " + fit.rich.b.toFixed(2) +
          ". The steep pooled line confounds education with family type.";
      }
    }

    function onShow() {
      if (Reveal.getIndices().h === index) redraw();
    }

    redraw();
    Reveal.on("slidechanged", onShow);
    window.addEventListener("resize", function () {
      if (Reveal.getIndices().h === index) redraw();
    });
  }

  if (typeof window !== "undefined") {
    window.startFamilyEdu = function () {
      if (window.__familyEduStarted) return;
      window.__familyEduStarted = true;
      mount();
    };
  }
})();
