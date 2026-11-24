/**
 * Interactive 2D PCA demo for Session 2.
 * Data-generating process inputs: Var(X1), Var(X2), Corr(X1,X2).
 */
(function () {
  const DEFAULTS = {
    n: 36,
    seed: 42,
    varX1: 0.25,
    varX2: 0.25,
    corr: 0.65,
  };

  /** Shared DGP params so slides 47 & 48 stay in sync. */
  const shared = { ...DEFAULTS };
  const demos = [];

  function mulberry32(a) {
    return function () {
      let t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gaussian(rand) {
    const u = Math.max(rand(), 1e-12);
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  /**
   * Bivariate normal cloud with exact population moments:
   *   Var(X1)=varX1, Var(X2)=varX2, Corr(X1,X2)=corr
   * via Cholesky: X = L Z, Z ~ N(0,I).
   */
  function generatePoints(params) {
    const n = params.n || DEFAULTS.n;
    const seed = params.seed || DEFAULTS.seed;
    const varX1 = Math.max(1e-6, Number(params.varX1));
    const varX2 = Math.max(1e-6, Number(params.varX2));
    const corr = clamp(Number(params.corr), -0.999, 0.999);

    const s1 = Math.sqrt(varX1);
    const s2 = Math.sqrt(varX2);
    const rand = mulberry32(seed);
    const pts = [];

    for (let i = 0; i < n; i++) {
      const z1 = gaussian(rand);
      const z2 = gaussian(rand);
      const x = s1 * z1;
      const y = s2 * (corr * z1 + Math.sqrt(1 - corr * corr) * z2);
      pts.push({ x, y });
    }
    return pts;
  }

  function axisExtent(pts) {
    let m = 0;
    for (const p of pts) m = Math.max(m, Math.abs(p.x), Math.abs(p.y));
    return Math.max(1.05, m * 1.2);
  }

  function mean(pts, key) {
    return pts.reduce((s, p) => s + p[key], 0) / pts.length;
  }

  function sampleVariance(pts, key, m) {
    const mu = m == null ? mean(pts, key) : m;
    let s = 0;
    for (const p of pts) {
      const d = p[key] - mu;
      s += d * d;
    }
    return s / (pts.length - 1);
  }

  function sampleCovariance(pts, mx, my) {
    let s = 0;
    for (const p of pts) s += (p.x - mx) * (p.y - my);
    return s / (pts.length - 1);
  }

  function runPCA(pts) {
    const mx = mean(pts, "x");
    const my = mean(pts, "y");
    const varX1 = sampleVariance(pts, "x", mx);
    const varX2 = sampleVariance(pts, "y", my);
    const covXY = sampleCovariance(pts, mx, my);
    const totalX = varX1 + varX2;
    const corrXY =
      varX1 > 0 && varX2 > 0 ? covXY / Math.sqrt(varX1 * varX2) : 0;

    const a = varX1;
    const b = covXY;
    const c = varX2;
    const trace = a + c;
    const det = a * c - b * b;
    const disc = Math.sqrt(Math.max(0, trace * trace - 4 * det));
    const lambda1 = (trace + disc) / 2;
    const lambda2 = (trace - disc) / 2;

    function eigenvector(lambda) {
      let v1;
      let v2;
      if (Math.abs(b) > 1e-10) {
        v1 = b;
        v2 = lambda - a;
      } else if (Math.abs(a - lambda) <= Math.abs(c - lambda)) {
        v1 = 1;
        v2 = 0;
      } else {
        v1 = 0;
        v2 = 1;
      }
      const norm = Math.hypot(v1, v2) || 1;
      v1 /= norm;
      v2 /= norm;
      if (v1 + v2 < 0) {
        v1 = -v1;
        v2 = -v2;
      }
      return { x: v1, y: v2 };
    }

    const e1 = eigenvector(lambda1);
    let e2 = { x: -e1.y, y: e1.x };
    if (e2.y < 0) e2 = { x: -e2.x, y: -e2.y };

    const scores = pts.map((p) => {
      const dx = p.x - mx;
      const dy = p.y - my;
      return {
        f1: dx * e1.x + dy * e1.y,
        f2: dx * e2.x + dy * e2.y,
      };
    });

    const varF1 = sampleVariance(scores, "f1");
    const varF2 = sampleVariance(scores, "f2");
    const totalF = varF1 + varF2;

    return {
      mx,
      my,
      varX1,
      varX2,
      corrXY,
      shareX1: totalX > 0 ? varX1 / totalX : 0,
      shareX2: totalX > 0 ? varX2 / totalX : 0,
      lambda1,
      lambda2,
      e1,
      e2,
      scores,
      varF1,
      varF2,
      keptF1: totalF > 0 ? varF1 / totalF : 0,
      keptF2: totalF > 0 ? varF2 / totalF : 0,
      angle: Math.atan2(e1.y, e1.x),
    };
  }

  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function format(n, digits) {
    if (n == null || Number.isNaN(n)) return "—";
    return n.toFixed(digits == null ? 3 : digits);
  }

  function formatPct(n) {
    if (n == null || Number.isNaN(n)) return "—";
    return (n * 100).toFixed(1) + "%";
  }

  function signedTerm(w, name, isFirst) {
    const a = Math.abs(w).toFixed(3);
    if (isFirst) return (w < 0 ? "−" : "") + a + " " + name;
    return (w < 0 ? " − " : " + ") + a + " " + name;
  }

  function formulaText(e, label) {
    return (
      label +
      " = " +
      signedTerm(e.x, "X1", true) +
      signedTerm(e.y, "X2", false)
    );
  }

  function readRootParams(root) {
    const d = root.dataset;
    return {
      n: Number(d.n) || DEFAULTS.n,
      seed: Number(d.seed) || DEFAULTS.seed,
      varX1: d.varX1 != null ? Number(d.varX1) : DEFAULTS.varX1,
      varX2: d.varX2 != null ? Number(d.varX2) : DEFAULTS.varX2,
      corr: d.corr != null ? Number(d.corr) : DEFAULTS.corr,
    };
  }

  function createDemo(root) {
    const mode = root.getAttribute("data-pca-demo") || "explained";
    const canvas = root.querySelector("canvas");
    const ctx = canvas.getContext("2d");

    const elVarX1 = root.querySelector("[data-var-x1]");
    const elVarX2 = root.querySelector("[data-var-x2]");
    const elShareX1 = root.querySelector("[data-share-x1]");
    const elShareX2 = root.querySelector("[data-share-x2]");
    const elVarF1 = root.querySelector("[data-var-f1]");
    const elVarF2 = root.querySelector("[data-var-f2]");
    const elKept = root.querySelector("[data-var-kept]");
    const elF1Formula = root.querySelector("[data-f1-formula]");
    const elF2Formula = root.querySelector("[data-f2-formula]");
    const formulasWrap = root.querySelector(".pca-formulas");
    const statusEl = root.querySelector("[data-pca-status]");
    const runBtn = root.querySelector("[data-pca-run]");
    const rotateBtn = root.querySelector("[data-pca-rotate]");
    const resetBtn = root.querySelector("[data-pca-reset]");
    const genBtn = root.querySelector("[data-pca-generate]");
    const inVarX1 = root.querySelector("[data-input-var-x1]");
    const inVarX2 = root.querySelector("[data-input-var-x2]");
    const inCorr = root.querySelector("[data-input-corr]");

    let points = [];
    let pca = null;
    let extent = 1.15;
    let phase = "original";
    let rotation = 0;
    let animId = null;
    let hoverIndex = -1;
    let layout = null;
    let tooltipEl = null;

    if (mode === "practice") {
      tooltipEl = document.createElement("div");
      tooltipEl.className = "pca-tooltip";
      tooltipEl.hidden = true;
      document.body.appendChild(tooltipEl);
    }

    function setStatus(text) {
      if (statusEl) statusEl.textContent = text;
    }

    function updateFormulas() {
      if (!pca) return;
      const show = phase === "rotated";
      if (formulasWrap) formulasWrap.classList.toggle("is-hidden", !show);
      if (!show) return;
      if (elF1Formula) elF1Formula.textContent = formulaText(pca.e1, "F1");
      if (elF2Formula) elF2Formula.textContent = formulaText(pca.e2, "F2");
    }

    function updateStats() {
      if (!pca) return;
      if (elVarX1) elVarX1.textContent = format(pca.varX1);
      if (elVarX2) elVarX2.textContent = format(pca.varX2);
      if (elShareX1) elShareX1.textContent = formatPct(pca.shareX1) + " of total";
      if (elShareX2) elShareX2.textContent = formatPct(pca.shareX2) + " of total";
      if (elVarF1) {
        elVarF1.textContent = phase === "original" ? "—" : format(pca.varF1);
      }
      if (elVarF2) {
        elVarF2.textContent = phase === "original" ? "—" : format(pca.varF2);
      }
      if (elKept) {
        elKept.textContent =
          phase === "original"
            ? "—"
            : formatPct(pca.keptF1) + " (F2: " + formatPct(pca.keptF2) + ")";
      }
      updateFormulas();
    }

    function syncButtons() {
      if (!runBtn) return;
      const busy = phase === "rotating";
      runBtn.disabled = phase !== "original" || busy;
      if (rotateBtn) {
        rotateBtn.disabled = phase !== "pcs" || busy;
        rotateBtn.textContent =
          phase === "rotated" ? "Already rotated" : "Rotate to F1, F2";
        if (phase === "rotated") rotateBtn.disabled = true;
      }
    }

    function syncInputsFromShared() {
      if (inVarX1) inVarX1.value = String(shared.varX1);
      if (inVarX2) inVarX2.value = String(shared.varX2);
      if (inCorr) inCorr.value = String(shared.corr);
    }

    function readInputsToShared() {
      if (inVarX1) shared.varX1 = Math.max(0.01, Number(inVarX1.value) || DEFAULTS.varX1);
      if (inVarX2) shared.varX2 = Math.max(0.01, Number(inVarX2.value) || DEFAULTS.varX2);
      if (inCorr) shared.corr = clamp(Number(inCorr.value) || DEFAULTS.corr, -0.99, 0.99);
      syncInputsFromShared();
    }

    function regenerate(opts) {
      stopAnim();
      if (opts && opts.fromInputs) readInputsToShared();
      points = generatePoints(shared);
      pca = runPCA(points);
      extent = axisExtent(points);
      phase = "original";
      rotation = 0;
      hoverIndex = -1;
      hideTooltip();
      updateStats();
      syncButtons();
      if (mode === "explained") {
        setStatus(
          "Set Var(X1), Var(X2), Corr → Generate. Sample shares of total variation appear below."
        );
      } else if (mode === "practice") {
        setStatus(
          "The data match the previous slide. Run PCA, then rotate. Hover a point for coordinates."
        );
      }
      draw();
    }

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      draw();
    }

    function worldToScreen(wx, wy, pad) {
      const w = canvas.width - pad * 2;
      const h = canvas.height - pad * 2;
      const scale = Math.min(w, h) / (2 * extent);
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      return {
        x: cx + wx * scale,
        y: cy - wy * scale,
        scale,
      };
    }

    function drawArrow(x0, y0, x1, y1, color, lineWidth) {
      const ang = Math.atan2(y1 - y0, x1 - x0);
      const head = 10 * (window.devicePixelRatio || 1);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - head * Math.cos(ang - 0.4), y1 - head * Math.sin(ang - 0.4));
      ctx.lineTo(x1 - head * Math.cos(ang + 0.4), y1 - head * Math.sin(ang + 0.4));
      ctx.closePath();
      ctx.fill();
    }

    function draw() {
      if (!pca) return;
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const pad = 28 * dpr;
      const ink = cssVar("--ink", "#1a1f24");
      const muted = cssVar("--muted", "#64748b");
      const accent = cssVar("--accent-2", "#0f766e");
      const line = cssVar("--line", "#d7dce3");
      const bg = cssVar("--bg-soft", "#eef1f4");
      const isDark = document.documentElement.getAttribute("data-theme") === "dark";
      const pointFill = isDark ? "#e8f1f8" : accent;
      const pointHover = isDark ? "#f5e6c8" : ink;
      const plotPad = isDark ? "rgba(15, 28, 36, 0.55)" : "rgba(255,255,255,0.55)";

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const target = -pca.angle;
      const theta = rotation * target;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);

      function rot(x, y) {
        return { x: x * cos - y * sin, y: x * sin + y * cos };
      }

      const tl = worldToScreen(-extent, extent, pad);
      const br = worldToScreen(extent, -extent, pad);
      ctx.fillStyle = plotPad;
      ctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
      ctx.strokeStyle = line;
      ctx.lineWidth = 1 * dpr;
      ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);

      const fullyRotated = rotation > 0.92;
      const showPcArrows = (phase === "pcs" || phase === "rotating") && !fullyRotated;
      const axisLen = extent * 0.92;

      // X1 / X2 always stay on the plot (they rotate with the cloud)
      {
        const ox0 = rot(-axisLen, 0);
        const ox1 = rot(axisLen, 0);
        const oy0 = rot(0, -axisLen);
        const oy1 = rot(0, axisLen);
        const sx0 = worldToScreen(ox0.x, ox0.y, pad);
        const sx1 = worldToScreen(ox1.x, ox1.y, pad);
        const sy0 = worldToScreen(oy0.x, oy0.y, pad);
        const sy1 = worldToScreen(oy1.x, oy1.y, pad);
        const xWidth = fullyRotated ? 1.6 * dpr : 2 * dpr;
        drawArrow(sx0.x, sx0.y, sx1.x, sx1.y, "#c45c4a", xWidth);
        drawArrow(sy0.x, sy0.y, sy1.x, sy1.y, "#3b6ea5", xWidth);
        ctx.font = `700 ${13 * dpr}px system-ui, sans-serif`;
        ctx.fillStyle = "#c45c4a";
        ctx.fillText("X1", sx1.x + 6 * dpr, sx1.y + 4 * dpr);
        ctx.fillStyle = "#3b6ea5";
        ctx.fillText("X2", sy1.x + 6 * dpr, sy1.y - 4 * dpr);
      }

      // After rotation, also show F1 / F2 as the new aligned axes
      if (fullyRotated) {
        const hx0 = worldToScreen(-axisLen, 0, pad);
        const hx1 = worldToScreen(axisLen, 0, pad);
        const hy0 = worldToScreen(0, -axisLen, pad);
        const hy1 = worldToScreen(0, axisLen, pad);
        drawArrow(hx0.x, hx0.y, hx1.x, hx1.y, ink, 2.4 * dpr);
        drawArrow(hy0.x, hy0.y, hy1.x, hy1.y, muted, 2.2 * dpr);
        ctx.font = `700 ${14 * dpr}px system-ui, sans-serif`;
        ctx.fillStyle = ink;
        ctx.fillText("F1", hx1.x + 6 * dpr, hx1.y + 18 * dpr);
        ctx.fillStyle = muted;
        ctx.fillText("F2", hy1.x + 10 * dpr, hy1.y - 4 * dpr);
      }

      const screenPts = [];
      const r = 4.2 * dpr;
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const c = { x: p.x - pca.mx, y: p.y - pca.my };
        const q = rot(c.x, c.y);
        const s = worldToScreen(q.x, q.y, pad);
        screenPts.push(s);
        ctx.beginPath();
        ctx.fillStyle = i === hoverIndex ? pointHover : pointFill;
        ctx.arc(s.x, s.y, i === hoverIndex ? r * 1.35 : r, 0, Math.PI * 2);
        ctx.fill();
      }

      if (showPcArrows) {
        const f1a = rot(pca.e1.x * axisLen, pca.e1.y * axisLen);
        const f1b = rot(-pca.e1.x * axisLen, -pca.e1.y * axisLen);
        const f2a = rot(pca.e2.x * axisLen * 0.8, pca.e2.y * axisLen * 0.8);
        const f2b = rot(-pca.e2.x * axisLen * 0.8, -pca.e2.y * axisLen * 0.8);
        const a1 = worldToScreen(f1b.x, f1b.y, pad);
        const b1 = worldToScreen(f1a.x, f1a.y, pad);
        const a2 = worldToScreen(f2b.x, f2b.y, pad);
        const b2 = worldToScreen(f2a.x, f2a.y, pad);

        drawArrow(a1.x, a1.y, b1.x, b1.y, ink, 2.6 * dpr);
        drawArrow(a2.x, a2.y, b2.x, b2.y, muted, 2.2 * dpr);

        ctx.font = `700 ${14 * dpr}px system-ui, sans-serif`;
        ctx.fillStyle = ink;
        ctx.fillText("F1", b1.x + 8 * dpr, b1.y + 4 * dpr);
        ctx.fillStyle = muted;
        ctx.fillText("F2", b2.x + 8 * dpr, b2.y - 4 * dpr);
      }

      layout = { pad, dpr, screenPts, r };
    }

    function hideTooltip() {
      if (!tooltipEl) return;
      tooltipEl.hidden = true;
    }

    function showTooltip(index, clientX, clientY) {
      if (!tooltipEl || index < 0 || !pca) {
        hideTooltip();
        return;
      }
      const p = points[index];
      const sc = pca.scores[index];
      const useFactors = phase === "rotated" || rotation > 0.92;
      tooltipEl.innerHTML = useFactors
        ? `<strong>X1</strong> ${p.x.toFixed(3)} &nbsp; <strong>X2</strong> ${p.y.toFixed(3)}<br/>` +
          `<strong>F1</strong> ${sc.f1.toFixed(3)} &nbsp; <strong>F2</strong> ${sc.f2.toFixed(3)}`
        : `<strong>X1</strong> ${p.x.toFixed(3)}<br/><strong>X2</strong> ${p.y.toFixed(3)}`;
      tooltipEl.hidden = false;

      // position:fixed in viewport px — immune to Reveal's CSS scale transform
      const pad = 14;
      tooltipEl.style.left = clientX + pad + "px";
      tooltipEl.style.top = clientY + pad + "px";

      const tipRect = tooltipEl.getBoundingClientRect();
      let left = clientX + pad;
      let top = clientY + pad;
      if (tipRect.right > window.innerWidth - 8) left = clientX - tipRect.width - pad;
      if (tipRect.bottom > window.innerHeight - 8) top = clientY - tipRect.height - pad;
      tooltipEl.style.left = Math.max(8, left) + "px";
      tooltipEl.style.top = Math.max(8, top) + "px";
    }

    function hitTest(evt) {
      if (!layout) return -1;
      const rect = canvas.getBoundingClientRect();
      const dpr = layout.dpr;
      const mx = (evt.clientX - rect.left) * (canvas.width / rect.width);
      const my = (evt.clientY - rect.top) * (canvas.height / rect.height);
      const hitR = Math.max(layout.r * 2.2, 10 * dpr);
      let best = -1;
      let bestD = hitR * hitR;
      for (let i = 0; i < layout.screenPts.length; i++) {
        const s = layout.screenPts[i];
        const dx = s.x - mx;
        const dy = s.y - my;
        const d2 = dx * dx + dy * dy;
        if (d2 <= bestD) {
          bestD = d2;
          best = i;
        }
      }
      return best;
    }

    function onPointerMove(evt) {
      if (mode !== "practice") return;
      const idx = hitTest(evt);
      if (idx !== hoverIndex) {
        hoverIndex = idx;
        draw();
      }
      if (idx >= 0) showTooltip(idx, evt.clientX, evt.clientY);
      else hideTooltip();
      canvas.style.cursor = idx >= 0 ? "pointer" : "default";
    }

    function onPointerLeave() {
      hoverIndex = -1;
      hideTooltip();
      canvas.style.cursor = "default";
      draw();
    }

    function stopAnim() {
      if (animId != null) {
        cancelAnimationFrame(animId);
        animId = null;
      }
    }

    function animateRotation() {
      stopAnim();
      phase = "rotating";
      syncButtons();
      hideTooltip();
      setStatus("Rotating the axes so F1 aligns with the horizontal…");
      const start = performance.now();
      const duration = 1400;
      const from = rotation;

      function frame(now) {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        rotation = from + (1 - from) * eased;
        draw();
        if (t < 1) {
          animId = requestAnimationFrame(frame);
        } else {
          rotation = 1;
          phase = "rotated";
          updateStats();
          syncButtons();
          setStatus("Scores on F1 and F2 — formulas below. Hover a point to read F1, F2.");
          draw();
        }
      }
      animId = requestAnimationFrame(frame);
    }

    function run() {
      stopAnim();
      phase = "pcs";
      rotation = 0;
      updateStats();
      syncButtons();
      setStatus(
        "PCA found F1 (max variance) and F2 (orthogonal). Compare Var(F1) vs Var(F2)."
      );
      draw();
    }

    function reset() {
      stopAnim();
      phase = "original";
      rotation = 0;
      hoverIndex = -1;
      hideTooltip();
      updateStats();
      syncButtons();
      setStatus("The data match the previous slide. Run PCA, then rotate. Hover a point for coordinates.");
      draw();
    }

    function generateAllFromInputs() {
      readInputsToShared();
      demos.forEach((d) => d.regenerate());
    }

    if (runBtn) runBtn.addEventListener("click", run);
    if (rotateBtn) rotateBtn.addEventListener("click", animateRotation);
    if (resetBtn) resetBtn.addEventListener("click", reset);
    if (genBtn) genBtn.addEventListener("click", generateAllFromInputs);
    [inVarX1, inVarX2, inCorr].forEach((el) => {
      if (!el) return;
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") generateAllFromInputs();
      });
    });
    if (mode === "practice") {
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerleave", onPointerLeave);
    }

    const api = {
      regenerate: function () {
        regenerate({ fromInputs: false });
      },
      resize,
      root,
    };
    demos.push(api);

    syncInputsFromShared();
    regenerate();
    resize();

    const ro = new ResizeObserver(() => resize());
    ro.observe(canvas);

    if (typeof Reveal !== "undefined") {
      Reveal.on("slidechanged", () => {
        const slide = root.closest("section");
        if (slide && Reveal.getCurrentSlide() === slide) resize();
        else hideTooltip();
      });
      Reveal.on("ready", () => resize());
    }

    const themeObs = new MutationObserver(() => draw());
    themeObs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
  }

  function init() {
    // Seed shared params from the first demo that declares data attributes
    const roots = Array.from(document.querySelectorAll("[data-pca-demo]"));
    if (roots[0]) Object.assign(shared, readRootParams(roots[0]));
    roots.forEach(createDemo);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
