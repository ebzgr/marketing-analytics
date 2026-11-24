/**
 * Interactive step-by-step K-means demo for Session 1.
 *
 * Controls:
 *  1) Data K + Generate → well-separated Gaussian blobs
 *  2) Clustering K + Step → init centroids, then assign / update
 *  On update → arrows from old centroid → new centroid
 *  On convergence → Voronoi decision regions over [0,10]²
 */
(function () {
  const N = 200;
  const COLORS = [
    "#0f766e",
    "#b45309",
    "#7c3aed",
    "#0369a1",
    "#be123c",
    "#4d7c0f",
    "#c2410c",
    "#4338ca",
  ];
  const REGION_ALPHA = 0.18;

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  function dist2(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  }

  function sampleGaussian(mx, my, sigma) {
    let u = 0;
    let v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    const mag = sigma * Math.sqrt(-2 * Math.log(u));
    const z0 = mag * Math.cos(2 * Math.PI * v);
    const z1 = mag * Math.sin(2 * Math.PI * v);
    return { x: mx + z0, y: my + z1 };
  }

  function placeCenters(g, minDist) {
    const centers = [];
    const maxTries = 400;
    for (let i = 0; i < g; i++) {
      let placed = false;
      for (let t = 0; t < maxTries; t++) {
        const c = { x: rand(2, 8), y: rand(2, 8) };
        if (centers.every((o) => Math.sqrt(dist2(c, o)) >= minDist)) {
          centers.push(c);
          placed = true;
          break;
        }
      }
      if (!placed) {
        centers.push({ x: rand(2, 8), y: rand(2, 8) });
      }
    }
    return centers;
  }

  /** Well-separated isotropic Gaussians; reject out-of-bounds instead of clipping. */
  function generateData(g) {
    g = clamp(g, 1, COLORS.length);
    const minDist = g <= 2 ? 3.2 : g === 3 ? 2.8 : 2.4;
    const sigma = g <= 2 ? 0.65 : 0.55;
    const centers = placeCenters(g, minDist);
    const per = Math.floor(N / g);
    const extra = N - per * g;
    const points = [];

    for (let i = 0; i < g; i++) {
      const count = per + (i < extra ? 1 : 0);
      let made = 0;
      let guard = 0;
      while (made < count && guard < count * 40) {
        guard++;
        const p = sampleGaussian(centers[i].x, centers[i].y, sigma);
        if (p.x < 0 || p.x > 10 || p.y < 0 || p.y > 10) continue;
        points.push({ x: p.x, y: p.y, cluster: -1 });
        made++;
      }
      while (made < count) {
        points.push({
          x: clamp(centers[i].x + rand(-0.3, 0.3), 0, 10),
          y: clamp(centers[i].y + rand(-0.3, 0.3), 0, 10),
          cluster: -1,
        });
        made++;
      }
    }
    return { points, centers };
  }

  function hexToRgba(hex, alpha) {
    const h = hex.replace("#", "");
    const n = parseInt(h, 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function createDemo(root) {
    const canvas = root.querySelector(".kmeans-canvas");
    const ctx = canvas.getContext("2d");
    const statusEl = root.querySelector(".kmeans-status");
    const kDataInput = root.querySelector(".kmeans-k-data");
    const kClustInput = root.querySelector(".kmeans-k-clust");
    const stepBtn = root.querySelector(".kmeans-step");
    const resetBtn = root.querySelector(".kmeans-reset");

    let points = [];
    let centroids = [];
    let moves = []; // { from, to, i } after centroid update
    let iteration = 0;
    let phase = "need-data"; // need-data | init | assign | update | done
    let showRegions = false;
    let dpr = 1;

    function kData() {
      return clamp(parseInt(kDataInput.value, 10) || 3, 1, COLORS.length);
    }

    function kClust() {
      return clamp(parseInt(kClustInput.value, 10) || 2, 1, COLORS.length);
    }

    function setStatus(msg) {
      statusEl.textContent = msg;
    }

    function setStepEnabled(on) {
      stepBtn.disabled = !on;
    }

    function resize() {
      const rect = canvas.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      draw();
    }

    function plotBounds() {
      const pad = 28 * dpr;
      return {
        pad,
        w: canvas.width - pad * 2,
        h: canvas.height - pad * 2,
      };
    }

    function toCanvas(p) {
      const { pad, w, h } = plotBounds();
      return {
        x: pad + (p.x / 10) * w,
        y: pad + (1 - p.y / 10) * h,
      };
    }

    function fromCanvas(cx, cy) {
      const { pad, w, h } = plotBounds();
      return {
        x: ((cx - pad) / w) * 10,
        y: (1 - (cy - pad) / h) * 10,
      };
    }

    function nearestCentroid(p) {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < centroids.length; i++) {
        const d = dist2(p, centroids[i]);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    }

    function drawAxes() {
      const { pad } = plotBounds();
      ctx.save();
      ctx.strokeStyle =
        getComputedStyle(document.documentElement).getPropertyValue("--line").trim() ||
        "rgba(0,0,0,0.12)";
      ctx.fillStyle =
        getComputedStyle(document.documentElement).getPropertyValue("--muted").trim() ||
        "#5a6570";
      ctx.lineWidth = 1 * dpr;
      ctx.font = `${11 * dpr}px "Source Sans 3", system-ui, sans-serif`;
      ctx.beginPath();
      ctx.moveTo(pad, pad);
      ctx.lineTo(pad, canvas.height - pad);
      ctx.lineTo(canvas.width - pad, canvas.height - pad);
      ctx.stroke();
      ctx.fillText("X1", canvas.width - pad - 18 * dpr, canvas.height - pad + 16 * dpr);
      ctx.fillText("X2", pad - 22 * dpr, pad + 4 * dpr);
      ctx.restore();
    }

    function drawRegions() {
      if (!showRegions || centroids.length === 0) return;
      const { pad, w, h } = plotBounds();
      const step = Math.max(2, Math.floor(3 * dpr));
      for (let py = pad; py < pad + h; py += step) {
        for (let px = pad; px < pad + w; px += step) {
          const p = fromCanvas(px + step / 2, py + step / 2);
          const c = nearestCentroid(p);
          ctx.fillStyle = hexToRgba(COLORS[c % COLORS.length], REGION_ALPHA);
          ctx.fillRect(px, py, step, step);
        }
      }
    }

    function drawArrow(from, to, color) {
      const a = toCanvas(from);
      const b = toCanvas(to);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1.5 * dpr) return;

      const angle = Math.atan2(dy, dx);
      const headLen = Math.min(14 * dpr, Math.max(8 * dpr, len * 0.35));
      const headAngle = 0.45;

      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 2.4 * dpr;
      ctx.lineCap = "round";
      ctx.globalAlpha = 0.95;

      const tipBack = headLen * 0.55;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x - Math.cos(angle) * tipBack, b.y - Math.sin(angle) * tipBack);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(
        b.x - headLen * Math.cos(angle - headAngle),
        b.y - headLen * Math.sin(angle - headAngle)
      );
      ctx.lineTo(
        b.x - headLen * Math.cos(angle + headAngle),
        b.y - headLen * Math.sin(angle + headAngle)
      );
      ctx.closePath();
      ctx.fill();

      // ghost mark at previous centroid
      const s = 6 * dpr;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1.8 * dpr;
      ctx.beginPath();
      ctx.moveTo(a.x - s, a.y);
      ctx.lineTo(a.x + s, a.y);
      ctx.moveTo(a.x, a.y - s);
      ctx.lineTo(a.x, a.y + s);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(a.x, a.y, 4 * dpr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    function drawMoves() {
      for (const m of moves) {
        drawArrow(m.from, m.to, COLORS[m.i % COLORS.length]);
      }
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawRegions();
      drawAxes();

      for (const p of points) {
        const c = toCanvas(p);
        const color =
          p.cluster >= 0 ? COLORS[p.cluster % COLORS.length] : "#94a3b8";
        ctx.beginPath();
        ctx.fillStyle = color;
        ctx.globalAlpha = p.cluster >= 0 ? 0.9 : 0.6;
        ctx.arc(c.x, c.y, 4.2 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      drawMoves();

      centroids.forEach((cen, i) => {
        const c = toCanvas(cen);
        const color = COLORS[i % COLORS.length];
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = "#fff";
        ctx.lineWidth = 2.5 * dpr;
        const s = 8 * dpr;
        ctx.beginPath();
        ctx.moveTo(c.x - s, c.y);
        ctx.lineTo(c.x + s, c.y);
        ctx.moveTo(c.x, c.y - s);
        ctx.lineTo(c.x, c.y + s);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(c.x, c.y, 5.5 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      });
    }

    function clearClustering() {
      centroids = [];
      moves = [];
      iteration = 0;
      showRegions = false;
      phase = points.length ? "init" : "need-data";
      setStepEnabled(!!points.length);
      points.forEach((p) => {
        p.cluster = -1;
      });
    }

    function resetData() {
      const g = kData();
      const data = generateData(g);
      points = data.points;
      clearClustering();
      setStepEnabled(true);
      setStatus(
        `Generated ${points.length} points in ${g} blob(s). Set Clustering K, then click Step to place centroids.`
      );
      draw();
    }

    function initCentroids() {
      const kk = kClust();
      if (!points.length) {
        setStatus("Generate data first (set Data K, then click Generate).");
        return;
      }
      const idxs = [...points.keys()];
      for (let i = idxs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
      }
      centroids = idxs.slice(0, kk).map((i) => ({
        x: points[i].x,
        y: points[i].y,
      }));
      points.forEach((p) => {
        p.cluster = -1;
      });
      iteration = 0;
      moves = [];
      showRegions = false;
      phase = "assign";
      setStepEnabled(true);
      setStatus(`Centroids initialized (Clustering K = ${kk}). Next: assign.`);
      draw();
    }

    function assign() {
      moves = [];
      for (const p of points) {
        p.cluster = nearestCentroid(p);
      }
      phase = "update";
      setStatus(`Iteration ${iteration} — assign done. Next: update centroids.`);
      draw();
    }

    function update() {
      const kk = centroids.length;
      const sums = Array.from({ length: kk }, () => ({ x: 0, y: 0, n: 0 }));
      for (const p of points) {
        if (p.cluster < 0) continue;
        sums[p.cluster].x += p.x;
        sums[p.cluster].y += p.y;
        sums[p.cluster].n += 1;
      }
      const nextMoves = [];
      let moved = false;
      for (let i = 0; i < kk; i++) {
        const from = { x: centroids[i].x, y: centroids[i].y };
        let to;
        if (sums[i].n === 0) {
          const p = points[Math.floor(Math.random() * points.length)];
          to = { x: p.x, y: p.y };
        } else {
          to = {
            x: sums[i].x / sums[i].n,
            y: sums[i].y / sums[i].n,
          };
        }
        if (Math.abs(to.x - from.x) + Math.abs(to.y - from.y) > 1e-6) {
          moved = true;
          nextMoves.push({ from, to, i });
        }
        centroids[i] = to;
      }
      moves = nextMoves;
      iteration += 1;
      if (moved) {
        phase = "assign";
        showRegions = false;
        setStepEnabled(true);
        setStatus(
          `Iteration ${iteration} — centroids updated (arrows show the move). Next: assign.`
        );
      } else {
        phase = "done";
        showRegions = true;
        moves = [];
        setStepEnabled(false);
        setStatus(
          `Converged after ${iteration} update(s). Map shows decision regions for new points.`
        );
      }
      draw();
    }

    function step() {
      if (stepBtn.disabled) return;
      if (!points.length || phase === "need-data") {
        setStatus("Generate data first (set Data K, then click Generate).");
        return;
      }
      if (phase === "init" || centroids.length !== kClust()) {
        initCentroids();
        return;
      }
      if (phase === "assign") {
        assign();
        return;
      }
      if (phase === "update") {
        update();
        return;
      }
      setStepEnabled(false);
      showRegions = true;
      draw();
    }

    stepBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      step();
    });
    resetBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      resetData();
    });
    kClustInput.addEventListener("change", () => {
      clearClustering();
      if (points.length) {
        setStepEnabled(true);
        setStatus(
          `Clustering K set to ${kClust()}. Click Step to initialize random centroids.`
        );
        draw();
      }
    });

    root.addEventListener("keydown", (e) => e.stopPropagation());
    root.addEventListener("mousedown", (e) => e.stopPropagation());

    window.addEventListener("resize", resize);
    if (typeof Reveal !== "undefined") {
      Reveal.on("slidechanged", resize);
      Reveal.on("ready", resize);
    }

    setStatus("Set Data K, then click Generate.");
    phase = "need-data";
    setStepEnabled(false);
    draw();
    resize();
  }

  function boot() {
    document.querySelectorAll("[data-kmeans-demo]").forEach(createDemo);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
