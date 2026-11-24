/**
 * Session 7 feedback results ([data-fb-*]).
 *
 * Responses are read live from the Apps Script web app (link on the "Refresh from Google" button),
 * in the same format as Google Forms' "Download responses (.csv)". Everything is computed in the
 * browser; no student responses are stored in this repository. Deleting needs the admin key.
 *
 * Column and option texts match create_feedback_form.gs (matched by their beginning, so small
 * edits at the end of a text are fine).
 */
(function () {
  var GRID_TITLE = "how much do you agree";
  var STATEMENTS = [
    { key: "coin_motivates", start: "The coin system motivates", label: "The coin system motivates me to participate more", neg: false },
    { key: "nocomp_not_attention", start: "The no-computer policy did not improve", label: "The no-computer policy did NOT improve my attention", neg: true },
    { key: "nocomp_talk", start: "Students talk more", label: "Students talk more here because of the no-computer policy", neg: false },
    { key: "coin_other_classes", start: "I think other classes", label: "Other classes could benefit from a coin system", neg: false },
    { key: "nocomp_learn", start: "The no-computer policy helped", label: "The no-computer policy helped me learn more", neg: false }
  ];
  var COIN = {
    title: "should coin rewards count",
    options: [
      { start: "Yes, use them as they are", label: "Yes, as they are" },
      { start: "Yes, but rescale", label: "Yes, but rescaled (smaller gap)" },
      { start: "No", label: "No" }
    ]
  };
  var AI_USE = {
    title: "think only of assignment 4",
    options: [
      { start: "AI produced almost all", label: "AI did almost all; I checked it ran", heavy: true },
      { start: "AI produced most", label: "AI did most; I changed some parts", heavy: true },
      { start: "About half", label: "About half AI, half me" },
      { start: "I did most of it", label: "I did most; AI helped debug / explain" },
      { start: "I did it almost entirely", label: "Almost entirely without AI" },
      { start: "I did little", label: "Teammates handled it" }
    ]
  };
  var EXPLAIN = {
    title: "if a classmate asked you",
    options: [
      { start: "Not really", label: "Not really", weak: true },
      { start: "Explain it only vaguely", label: "Only vaguely", weak: true },
      { start: "Explain the main idea", label: "Main idea, not the calculation" },
      { start: "Explain it step by step", label: "Step by step, and redo it" }
    ]
  };
  var GUESS_TITLE = "imagine 10 typical students";

  /* ---------- helpers ---------- */
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function pct(x) { return Math.round(100 * x) + "%"; }

  function norm(s) { return String(s || "").trim().toLowerCase(); }

  function parseCsv(text) {
    var rows = [], row = [], field = "", i = 0, q = false;
    text = text.replace(/^﻿/, "");
    while (i < text.length) {
      var c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
        } else field += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += c;
      i++;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (v) { return v.trim() !== ""; }); });
  }

  function findCol(header, starts) {
    for (var i = 0; i < header.length; i++) if (norm(header[i]).indexOf(starts) === 0) return i;
    return -1;
  }

  function gridCol(header, statementStart) {
    for (var i = 0; i < header.length; i++) {
      var h = norm(header[i]);
      if (h.indexOf(GRID_TITLE) === 0 && h.indexOf("[" + norm(statementStart)) > -1) return i;
    }
    return -1;
  }

  function matchOption(value, options) {
    var v = norm(value);
    if (!v) return -1;
    for (var i = 0; i < options.length; i++) if (v.indexOf(norm(options[i].start)) === 0) return i;
    return -1;
  }

  /* ---------- data model ---------- */
  function fromCsv(text) {
    var rows = parseCsv(text);
    if (rows.length < 1) throw new Error("The file is empty.");   // header only = 0 responses, which is fine
    var header = rows[0], body = rows.slice(1);
    var cols = {
      grid: STATEMENTS.map(function (s) { return gridCol(header, s.start); }),
      coin: findCol(header, COIN.title),
      use: findCol(header, AI_USE.title),
      explain: findCol(header, EXPLAIN.title),
      guess: findCol(header, GUESS_TITLE)
    };
    var found = cols.grid.filter(function (c) { return c > -1; }).length + [cols.coin, cols.use, cols.explain, cols.guess].filter(function (c) { return c > -1; }).length;
    if (found === 0) throw new Error("This does not look like the feedback form export.");
    return body.map(function (r) {
      var g = {};
      STATEMENTS.forEach(function (s, k) {
        var v = cols.grid[k] > -1 ? parseInt(r[cols.grid[k]], 10) : NaN;
        g[s.key] = v >= 1 && v <= 5 ? v : null;
      });
      var guess = cols.guess > -1 ? parseFloat(r[cols.guess]) : NaN;
      return {
        grid: g,
        coin: cols.coin > -1 ? matchOption(r[cols.coin], COIN.options) : -1,
        use: cols.use > -1 ? matchOption(r[cols.use], AI_USE.options) : -1,
        explain: cols.explain > -1 ? matchOption(r[cols.explain], EXPLAIN.options) : -1,
        guess: guess >= 0 && guess <= 10 ? guess : null
      };
    });
  }

  /* ---------- rendering ---------- */
  var DATA = null, SOURCE = "";

  function setStatus(text, error) {
    document.querySelectorAll("[data-fb-status]").forEach(function (s) {
      s.textContent = text;
      s.classList.toggle("error", !!error);
    });
  }

  function empty(box, msg) {
    box.innerHTML = "";
    box.appendChild(el("p", "res-empty", msg || "Load the responses on the first results slide."));
  }

  function hbars(box, labels, counts, opts) {
    opts = opts || {};
    box.innerHTML = "";
    var total = counts.reduce(function (a, b) { return a + b; }, 0);
    var max = Math.max.apply(null, counts.concat([1]));
    labels.forEach(function (lab, i) {
      var row = el("div", "fb-bar-row" + (opts.flag && opts.flag[i] ? " flag" : ""));
      row.appendChild(el("span", "fb-bar-lab", lab));
      var track = el("span", "fb-bar-track");
      var fill = el("span", "fb-bar-fill");
      fill.style.width = (100 * counts[i] / max).toFixed(1) + "%";
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el("span", "fb-bar-val", total ? pct(counts[i] / total) + " (" + counts[i] + ")" : "–"));
      box.appendChild(row);
    });
    if (opts.n !== false) box.appendChild(el("p", "fig-caption", "n = " + total + " answers"));
  }

  function renderGrid() {
    var box = document.querySelector("[data-fb-grid]");
    if (!box) return;
    if (!DATA) return empty(box);
    box.innerHTML = "";
    STATEMENTS.forEach(function (s) {
      var counts = [0, 0, 0, 0, 0], sum = 0, n = 0;
      DATA.forEach(function (d) { var v = d.grid[s.key]; if (v) { counts[v - 1]++; sum += v; n++; } });
      var row = el("div", "fb-lik-row");
      var lab = el("span", "fb-lik-lab", s.label);
      row.appendChild(lab);
      var bar = el("span", "fb-lik-bar");
      counts.forEach(function (c, k) {
        var seg = el("span", "fb-lik-seg s" + (k + 1), n && c / n >= 0.07 ? pct(c / n) : "");
        seg.style.width = n ? (100 * c / n).toFixed(1) + "%" : "0";
        seg.title = (k + 1) + ": " + c + " answers";
        bar.appendChild(seg);
      });
      row.appendChild(bar);
      row.appendChild(el("span", "fb-lik-mean", n ? (sum / n).toFixed(1) : "–"));
      box.appendChild(row);
    });
    var key = el("div", "fb-lik-key");
    ["1 fully disagree", "2", "3", "4", "5 fully agree"].forEach(function (t, k) {
      var it = el("span", "fb-key-item");
      it.appendChild(el("span", "fb-key-sw s" + (k + 1)));
      it.appendChild(document.createTextNode(t));
      key.appendChild(it);
    });
    key.appendChild(el("span", "fb-key-item fb-key-mean", "right: average (1–5)"));
    box.appendChild(key);
  }

  function countOptions(field, options) {
    var c = options.map(function () { return 0; });
    DATA.forEach(function (d) { if (d[field] > -1) c[d[field]]++; });
    return c;
  }

  function renderCoin() {
    var box = document.querySelector("[data-fb-coin]");
    if (!box) return;
    if (!DATA) return empty(box);
    hbars(box, COIN.options.map(function (o) { return o.label; }), countOptions("coin", COIN.options));
  }

  function renderAi() {
    var useBox = document.querySelector("[data-fb-use]");
    var expBox = document.querySelector("[data-fb-explain]");
    if (useBox) {
      if (!DATA) empty(useBox);
      else hbars(useBox, AI_USE.options.map(function (o) { return o.label; }), countOptions("use", AI_USE.options),
        { flag: AI_USE.options.map(function (o) { return !!o.heavy; }) });
    }
    if (expBox) {
      if (!DATA) empty(expBox);
      else hbars(expBox, EXPLAIN.options.map(function (o) { return o.label; }), countOptions("explain", EXPLAIN.options),
        { flag: EXPLAIN.options.map(function (o) { return !!o.weak; }) });
    }
  }

  function renderSummary() {
    var guessBox = document.querySelector("[data-fb-guess]");
    var cards = document.querySelector("[data-fb-summary]");
    if (!guessBox && !cards) return;
    if (!DATA) {
      if (guessBox) empty(guessBox);
      if (cards) cards.innerHTML = "";
      return;
    }
    var guesses = DATA.map(function (d) { return d.guess; }).filter(function (g) { return g != null; });
    if (guessBox) {
      var counts = []; for (var k = 0; k <= 10; k++) counts.push(0);
      guesses.forEach(function (g) { counts[Math.round(g)]++; });
      guessBox.innerHTML = "";
      var max = Math.max.apply(null, counts.concat([1]));
      var hist = el("div", "fb-hist");
      counts.forEach(function (c, k) {
        var col = el("div", "fb-hist-col");
        var b = el("span", "fb-hist-bar");
        b.style.height = (100 * c / max).toFixed(1) + "%";
        b.title = k + " out of 10: " + c + " answers";
        col.appendChild(el("span", "fb-hist-n", c ? String(c) : ""));
        col.appendChild(b);
        col.appendChild(el("span", "fb-hist-x", String(k)));
        hist.appendChild(col);
      });
      guessBox.appendChild(hist);
      guessBox.appendChild(el("p", "fig-caption", "“Out of 10 typical students, how many mostly pasted the assignment into AI?” · n = " + guesses.length));
    }
    if (cards) {
      var answeredUse = DATA.filter(function (d) { return d.use > -1; });
      var heavy = answeredUse.filter(function (d) { return AI_USE.options[d.use].heavy; }).length;
      var floor = answeredUse.length ? heavy / answeredUse.length : null;
      var meanGuess = guesses.length ? guesses.reduce(function (a, b) { return a + b; }, 0) / guesses.length / 10 : null;
      var both = DATA.filter(function (d) { return d.use > -1 && d.explain > -1; });
      var outsourced = both.filter(function (d) { return AI_USE.options[d.use].heavy && EXPLAIN.options[d.explain].weak; }).length;
      var freeRide = answeredUse.filter(function (d) { return d.use === AI_USE.options.length - 1; }).length;
      cards.innerHTML = "";
      [
        [floor == null ? "–" : pct(floor), "said AI did most or all of their part (a floor)"],
        [meanGuess == null ? "–" : pct(meanGuess), "classmates’ average guess (an upper estimate)"],
        [both.length ? pct(outsourced / both.length) : "–", "AI did most AND could not really explain it"],
        [answeredUse.length ? pct(freeRide / answeredUse.length) : "–", "teammates did their part (free riding)"]
      ].forEach(function (c, i) {
        var s = el("div", "stat" + (i === 2 ? " warm" : ""));
        s.appendChild(el("span", "stat-value", c[0]));
        s.appendChild(el("span", "stat-label", c[1]));
        cards.appendChild(s);
      });
    }
  }

  function renderAll() {
    renderGrid();
    renderCoin();
    renderAi();
    renderSummary();
  }

  var lastCount = null;

  function updateCount(n) {
    document.querySelectorAll("[data-fb-count]").forEach(function (c) {
      c.textContent = String(n);
      if (lastCount != null && n > lastCount) {       // small pulse when a new answer arrives
        c.classList.remove("bump");
        void c.offsetWidth;
        c.classList.add("bump");
      }
    });
    lastCount = n;
  }

  function load(data, source) {
    DATA = data;
    SOURCE = source;
    updateCount(data.length);
    setStatus(data.length + " responses loaded" + (source ? " · " + source : ""));
    renderAll();
  }

  /* ---------- live loading from the Apps Script web app ---------- */
  // The web-app URL is kept only in this browser (localStorage), never in the slide files.
  var LS_KEY = "ma-s7-feedback-live-url";
  var liveTimer = null;

  function builtInUrl() {
    var b = document.querySelector("[data-fb-live][data-url]");
    return b ? b.getAttribute("data-url") : "";
  }
  function getUrl() {
    var u = "";
    try { u = localStorage.getItem(LS_KEY) || ""; } catch (e) {}
    return u || builtInUrl();
  }
  function setUrl(u) { try { if (u) localStorage.setItem(LS_KEY, u); else localStorage.removeItem(LS_KEY); } catch (e) {} }

  function askUrl() {
    var u = window.prompt("Paste the Apps Script Web app URL (it ends with /exec):", getUrl());
    if (u == null) return "";
    u = u.trim();
    if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(u)) {
      setStatus("That does not look like an Apps Script web-app URL.", true);
      return "";
    }
    setUrl(u);
    return u;
  }

  function fetchLive(quiet) {
    var url = getUrl();
    if (!url) return;
    if (!quiet) setStatus("Loading from Google…");
    fetch(url + (url.indexOf("?") > -1 ? "&" : "?") + "_ts=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
      .then(function (text) {
        load(fromCsv(text), "live from Google · " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      })
      .catch(function (e) {
        setStatus("Could not load from Google (" + e.message + "). Check the web-app access is set to “Anyone”.", true);
      });
  }

  var KEY_LS = "ma-s7-feedback-admin-key";

  function panel() { return document.querySelector("[data-fb-clear-panel]"); }

  function openClearPanel() {
    var p = panel();
    if (!p) return;
    var input = p.querySelector("[data-fb-key]");
    var saved = "";
    try { saved = localStorage.getItem(KEY_LS) || ""; } catch (e) {}
    input.value = saved;
    p.hidden = false;
    input.focus();
  }

  function closeClearPanel() {
    var p = panel();
    if (p) p.hidden = true;
  }

  function clearAll() {
    var url = getUrl();
    if (!url) { setStatus("No Google link configured.", true); return; }
    var key = (panel().querySelector("[data-fb-key]").value || "").trim();
    if (!key) { setStatus("Type the admin key first.", true); return; }
    closeClearPanel();
    setStatus("Deleting…");
    fetch(url + (url.indexOf("?") > -1 ? "&" : "?") + "action=clear&key=" + encodeURIComponent(key) + "&_ts=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
      .then(function (text) {
        var res;
        try { res = JSON.parse(text); }
        catch (e) {
          if (/authori[sz]/i.test(text)) throw new Error("Google needs you to authorize the script again: in Apps Script run “authorizeDrive” once, then redeploy a new version");
          if (/^\s*"?Timestamp/.test(text)) throw new Error("the deployed script is an old version: Deploy → Manage deployments → Edit → New version");
          throw new Error("unexpected reply from Google");
        }
        if (!res.ok) {
          try { localStorage.removeItem(KEY_LS); } catch (e) {}
          throw new Error(res.error === "wrong key" ? "wrong admin key" : res.error || "not deleted");
        }
        try { localStorage.setItem(KEY_LS, key); } catch (e) {}
        DATA = null;
        updateCount(0);
        renderAll();
        setStatus("Deleted " + res.deleted + " responses" +
          (res.backup ? " · backup in Google Drive: " + res.backup : "") +
          (res.backupError ? " · backup failed: " + res.backupError : "") + ". Ready for the next class.");
      })
      .catch(function (e) { setStatus("Could not delete: " + e.message + ".", true); });
  }

  function currentSlide() {
    return window.Reveal && Reveal.getCurrentSlide ? Reveal.getCurrentSlide() : null;
  }

  function onResultsSlide() {
    var cur = currentSlide();
    return !!(cur && cur.querySelector("[data-fb-grid],[data-fb-coin],[data-fb-use],[data-fb-guess]"));
  }

  function onQrSlide() {
    var cur = currentSlide();
    return !!(cur && cur.querySelector("[data-fb-count]"));
  }

  // Refresh every 5 s on the QR slide (live counter) and every 15 s on the results slides.
  var ticks = 0;
  function startAutoRefresh() {
    if (liveTimer) return;
    liveTimer = setInterval(function () {
      ticks++;
      if (onQrSlide() || (onResultsSlide() && ticks % 3 === 0)) fetchLive(true);
    }, 5000);
  }

  function autoLoadOnArrival() {
    if (!window.Reveal || !Reveal.on) return;
    var started = false;
    function check() {
      if (!started && (onResultsSlide() || onQrSlide()) && getUrl() && true) {
        started = true;
        fetchLive(false);
        startAutoRefresh();
      }
    }
    Reveal.on("slidechanged", check);
    check();
  }

  window.startFeedbackResults = function () {
    document.querySelectorAll("[data-fb-live]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var url = getUrl();
        if (!url || ev.shiftKey) url = askUrl();      // Shift+click to use a different link (kept in this browser)
        if (!url) return;
        fetchLive(false);
        startAutoRefresh();
      });
    });
    document.querySelectorAll("[data-fb-clear]").forEach(function (b) {
      b.addEventListener("click", openClearPanel);
    });
    document.querySelectorAll("[data-fb-clear-confirm]").forEach(function (b) {
      b.addEventListener("click", clearAll);
    });
    document.querySelectorAll("[data-fb-clear-cancel]").forEach(function (b) {
      b.addEventListener("click", closeClearPanel);
    });
    document.querySelectorAll("[data-fb-key]").forEach(function (input) {
      input.addEventListener("keydown", function (e) {
        e.stopPropagation();                       // keep Reveal from treating typing as navigation
        if (e.key === "Enter") clearAll();
        if (e.key === "Escape") closeClearPanel();
      });
    });
    autoLoadOnArrival();
    renderAll();
  };

  // For testing or loading programmatically: FeedbackResults.loadCsvText(text, "label")
  window.FeedbackResults = {
    loadCsvText: function (text, label) { load(fromCsv(text), label || ""); }
  };
})();
