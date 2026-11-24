/**
 * Session 6 interactive widgets (conjoint analysis).
 *  - [data-pizza-builder]: pick one level per attribute; the preference score is the sum of partworths.
 *  - [data-conjoint-regression]: rate nine pizza profiles; dummy-variable OLS estimates the partworths,
 *    which are rescaled to the 0-100 convention and turned into attribute importances.
 *  - [data-choice-rules]: three preference scores turned into market shares under
 *    first choice, logit, share of preference, and random choice rules.
 */
(function () {
  /* ----- Pizza example: attributes, levels and average partworths (slide "Preference partworths") ----- */
  var ATTRS = [
    { key: "size", name: "Size", levels: [
      { label: "Small", pw: 0, icon: "pizza-small.png" },
      { label: "Large", pw: 10, icon: "pizza-large.png" }
    ] },
    { key: "type", name: "Type", levels: [
      { label: "Pepperoni", pw: 40, icon: "pizza-pepperoni.png" },
      { label: "Mushroom", pw: 0, icon: "pizza-mushroom.png" },
      { label: "4 seasons", pw: 30, icon: "pizza-four-seasons.png" }
    ] },
    { key: "price", name: "Price", levels: [
      { label: "9 €", pw: 50 },
      { label: "12 €", pw: 30 },
      { label: "15 €", pw: 0 }
    ] }
  ];

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function readNumber(input) {
    var v = parseFloat(input.value);
    if (!isFinite(v)) v = parseFloat(input.defaultValue) || 0;
    var lo = input.min !== "" ? parseFloat(input.min) : -Infinity;
    var hi = input.max !== "" ? parseFloat(input.max) : Infinity;
    return clamp(v, lo, hi);
  }

  function pct(x) {
    return Math.round(x * 100) + "%";
  }

  /* ----- Widget 1: build a pizza ----- */
  function mountPizzaBuilder(root) {
    var choice = { size: 1, type: 0, price: 0 };
    var groups = root.querySelector("[data-pb-groups]");
    var out = root.querySelector("[data-pb-score]");
    var bar = root.querySelector("[data-pb-bar]");
    var sum = root.querySelector("[data-pb-sum]");

    ATTRS.forEach(function (attr) {
      var g = el("div", "pb-group");
      g.appendChild(el("span", "pb-attr", attr.name));
      var row = el("div", "pb-levels");
      attr.levels.forEach(function (lvl, i) {
        var b = el("button", "pb-level");
        b.type = "button";
        if (lvl.icon) {
          var img = el("img");
          img.src = "assets/" + lvl.icon;
          img.alt = "";
          b.appendChild(img);
        }
        b.appendChild(el("span", "pb-label", lvl.label));
        b.appendChild(el("span", "pb-pw", "+" + lvl.pw));
        b.addEventListener("click", function () {
          choice[attr.key] = i;
          render();
        });
        row.appendChild(b);
      });
      g.appendChild(row);
      groups.appendChild(g);
    });

    function render() {
      var total = 0;
      var parts = [];
      ATTRS.forEach(function (attr, a) {
        var idx = choice[attr.key];
        var lvl = attr.levels[idx];
        total += lvl.pw;
        parts.push(lvl.label + " (" + lvl.pw + ")");
        var btns = groups.children[a].querySelectorAll(".pb-level");
        Array.prototype.forEach.call(btns, function (b, i) {
          b.classList.toggle("on", i === idx);
          b.setAttribute("aria-pressed", String(i === idx));
        });
      });
      out.textContent = total;
      bar.style.width = total + "%";
      sum.textContent = parts.join(" + ") + " = " + total;
    }
    render();
  }

  /* ----- Widget 2: estimate partworths by regression ----- */
  // Profiles: [size, type, price] level indices, with default ratings close to the average partworths.
  var PROFILES = [
    [1, 0, 0, 95], [0, 2, 1, 60], [0, 1, 2, 5], [1, 0, 1, 80], [1, 1, 0, 60],
    [0, 0, 2, 45], [1, 2, 2, 35], [0, 1, 1, 25], [0, 2, 0, 85]
  ];

  /** Solves (X'X) b = X'y by Gaussian elimination with partial pivoting. Returns null if singular. */
  function ols(X, y) {
    var k = X[0].length;
    var A = [];
    for (var i = 0; i < k; i++) {
      A.push([]);
      for (var j = 0; j <= k; j++) {
        var s = 0;
        for (var r = 0; r < X.length; r++) s += X[r][i] * (j < k ? X[r][j] : y[r]);
        A[i].push(s);
      }
    }
    for (var c = 0; c < k; c++) {
      var p = c;
      for (var r2 = c + 1; r2 < k; r2++) if (Math.abs(A[r2][c]) > Math.abs(A[p][c])) p = r2;
      if (Math.abs(A[p][c]) < 1e-9) return null;
      var tmp = A[c]; A[c] = A[p]; A[p] = tmp;
      for (var r3 = 0; r3 < k; r3++) {
        if (r3 === c) continue;
        var f = A[r3][c] / A[c][c];
        for (var j2 = c; j2 <= k; j2++) A[r3][j2] -= f * A[c][j2];
      }
    }
    return A.map(function (row, i2) { return row[k] / row[i2]; });
  }

  // Dummy coding: base levels are Small, Pepperoni, 9 € (coefficient 0).
  function designRow(p) {
    return [1, p[0] === 1 ? 1 : 0, p[1] === 1 ? 1 : 0, p[1] === 2 ? 1 : 0, p[2] === 1 ? 1 : 0, p[2] === 2 ? 1 : 0];
  }

  function mountRegression(root) {
    var tbody = root.querySelector("[data-reg-rows]");
    var inputs = [];
    PROFILES.forEach(function (p, i) {
      var tr = el("tr");
      tr.appendChild(el("td", null, String(i + 1)));
      ATTRS.forEach(function (attr, a) {
        tr.appendChild(el("td", "left", attr.levels[p[a]].label));
      });
      var td = el("td");
      var inp = el("input");
      inp.type = "number";
      inp.min = "0";
      inp.max = "100";
      inp.step = "5";
      inp.value = String(p[3]);
      inp.defaultValue = String(p[3]);
      inp.setAttribute("aria-label", "Rating of profile " + (i + 1));
      inp.addEventListener("input", render);
      inputs.push(inp);
      td.appendChild(inp);
      tr.appendChild(td);
      tbody.appendChild(tr);
    });

    var pwBody = root.querySelector("[data-reg-pw]");
    var impBox = root.querySelector("[data-reg-imp]");
    var r2Out = root.querySelector("[data-reg-r2]");
    root.querySelector("[data-reg-reset]").addEventListener("click", function () {
      inputs.forEach(function (inp, i) { inp.value = String(PROFILES[i][3]); });
      render();
    });

    function render() {
      var X = PROFILES.map(designRow);
      var y = inputs.map(readNumber);
      var b = ols(X, y);
      pwBody.innerHTML = "";
      impBox.innerHTML = "";
      if (!b) { r2Out.textContent = "–"; return; }

      // Raw coefficients per level (base level = 0).
      var raw = [[0, b[1]], [0, b[2], b[3]], [0, b[4], b[5]]];
      // Rescale: worst level of each attribute = 0, sum of best levels = 100.
      var ranges = raw.map(function (lv) {
        return Math.max.apply(null, lv) - Math.min.apply(null, lv);
      });
      var totalRange = ranges.reduce(function (a, c) { return a + c; }, 0) || 1;
      ATTRS.forEach(function (attr, a) {
        var mn = Math.min.apply(null, raw[a]);
        attr.levels.forEach(function (lvl, i) {
          var tr = el("tr");
          tr.appendChild(el("td", "left", i === 0 ? attr.name : ""));
          tr.appendChild(el("td", "left", lvl.label));
          tr.appendChild(el("td", null, raw[a][i].toFixed(1)));
          tr.appendChild(el("td", "key", Math.round(((raw[a][i] - mn) / totalRange) * 100)));
          pwBody.appendChild(tr);
        });
        var imp = ranges[a] / totalRange;
        var row = el("div", "imp-row");
        row.appendChild(el("span", "imp-name", attr.name));
        var track = el("span", "imp-track");
        var fill = el("span", "imp-fill");
        fill.style.width = (imp * 100).toFixed(1) + "%";
        track.appendChild(fill);
        row.appendChild(track);
        row.appendChild(el("span", "imp-val", pct(imp)));
        impBox.appendChild(row);
      });

      var mean = y.reduce(function (a, c) { return a + c; }, 0) / y.length;
      var sse = 0, sst = 0;
      X.forEach(function (row, i) {
        var pred = row.reduce(function (a, x, j) { return a + x * b[j]; }, 0);
        sse += Math.pow(y[i] - pred, 2);
        sst += Math.pow(y[i] - mean, 2);
      });
      r2Out.textContent = sst > 0 ? (1 - sse / sst).toFixed(2) : "–";
    }
    render();
  }

  /* ----- Widget 3: choice rules ----- */
  var RULES = [
    { key: "first", name: "First choice" },
    { key: "logit", name: "Logit" },
    { key: "sop", name: "Share of preference" },
    { key: "random", name: "Random" }
  ];

  function shares(scores, rule, beta) {
    var n = scores.length;
    if (rule === "random") return scores.map(function () { return 1 / n; });
    if (rule === "first") {
      var mx = Math.max.apply(null, scores);
      var ties = scores.filter(function (s) { return s === mx; }).length;
      return scores.map(function (s) { return s === mx ? 1 / ties : 0; });
    }
    if (rule === "sop") {
      var tot = scores.reduce(function (a, c) { return a + c; }, 0);
      return scores.map(function (s) { return tot > 0 ? s / tot : 1 / n; });
    }
    var ex = scores.map(function (s) { return Math.exp(beta * s); });
    var z = ex.reduce(function (a, c) { return a + c; }, 0);
    return ex.map(function (e) { return e / z; });
  }

  function mountChoiceRules(root) {
    var sliders = root.querySelectorAll("[data-cr-score]");
    var betaInput = root.querySelector("[data-cr-beta]");
    var betaOut = root.querySelector("[data-cr-beta-out]");
    var tbody = root.querySelector("[data-cr-rows]");
    var names = ["A", "B", "C"];

    var cells = names.map(function (nm, p) {
      var tr = el("tr");
      tr.appendChild(el("td", "left", "Product " + nm));
      var row = RULES.map(function () {
        var td = el("td", "cr-cell");
        var track = el("span", "cr-track");
        var fill = el("span", "cr-fill p" + p);
        track.appendChild(fill);
        var val = el("span", "cr-val");
        td.appendChild(track);
        td.appendChild(val);
        tr.appendChild(td);
        return { fill: fill, val: val };
      });
      tbody.appendChild(tr);
      return row;
    });

    function render() {
      var scores = Array.prototype.map.call(sliders, function (s) {
        var v = readNumber(s);
        var o = root.querySelector('[data-cr-score-out="' + s.getAttribute("data-cr-score") + '"]');
        if (o) o.textContent = v;
        return v;
      });
      var beta = readNumber(betaInput);
      betaOut.textContent = beta.toFixed(2);
      RULES.forEach(function (rule, r) {
        var sh = shares(scores, rule.key, beta);
        sh.forEach(function (s, p) {
          cells[p][r].fill.style.width = (s * 100).toFixed(1) + "%";
          cells[p][r].val.textContent = pct(s);
        });
      });
    }

    Array.prototype.forEach.call(sliders, function (s) { s.addEventListener("input", render); });
    betaInput.addEventListener("input", render);
    render();
  }

  /* Keyboard input inside widgets should not move the slides. */
  function shieldKeys(root) {
    root.addEventListener("keydown", function (e) {
      if (e.target.matches("input")) e.stopPropagation();
    });
  }

  /* ----- Accordion: hidden .acc-step fragments drive which panel is open ----- */
  function mountAccordion(section) {
    var items = section.querySelectorAll(".acc-item");
    var steps = section.querySelectorAll(".acc-step");

    function sync() {
      var shown = section.querySelectorAll(".acc-step.visible").length;
      Array.prototype.forEach.call(items, function (item, i) {
        item.classList.toggle("open", i === shown - 1);
        item.classList.toggle("seen", i < shown);
      });
    }

    Array.prototype.forEach.call(items, function (item, i) {
      item.querySelector(".acc-head").addEventListener("click", function () {
        if (window.Reveal && Reveal.getCurrentSlide() === section) Reveal.navigateFragment(i);
      });
    });
    if (window.Reveal) {
      ["fragmentshown", "fragmenthidden", "slidechanged", "ready"].forEach(function (ev) {
        Reveal.on(ev, sync);
      });
    }
    sync();
    return steps;
  }

  /* ----- Choice-based conjoint demo: pick one of two random trips, then a new pair appears ----- */
  var TRIP_ATTRS = [
    { name: "Destination", levels: [["🏖️", "South of France (beach)"], ["🏔️", "Alpes françaises"], ["🏙️", "London"], ["🏰", "Carcassonne"]] },
    { name: "Travel", levels: [["🚌", "Party bus"], ["🚆", "Train"], ["✈️", "Airplane"]] },
    { name: "Stay", levels: [["⛺", "Camping site"], ["🛏️", "Hostel"], ["🏨", "Standard hotel"], ["🌟", "Luxury hotel"]] },
    { name: "Meals", levels: [["🚫", "No meal"], ["🥐", "Breakfast only"], ["🍽️", "Breakfast, lunch, dinner"], ["🍹", "All inclusive"]] },
    { name: "Extra", levels: [["➖", "No extra"], ["📸", "Photographer"], ["🎧", "DJ"], ["🎁", "Photographer + DJ + souvenirs"]] }
  ];

  function randomTrip() {
    return TRIP_ATTRS.map(function (a) { return Math.floor(Math.random() * a.levels.length); });
  }

  /** Two trips that differ in at least three attributes, so every choice is a real trade-off. */
  function randomPair() {
    var a = randomTrip(), b;
    do {
      b = randomTrip();
      var diff = a.filter(function (x, i) { return x !== b[i]; }).length;
    } while (diff < 3);
    return [a, b];
  }

  function mountChoiceTask(root) {
    var box = root.querySelector("[data-cbc-options]");
    var count = root.querySelector("[data-cbc-count]");
    var none = root.querySelector("[data-cbc-none]");
    var task = 0;
    var busy = false;

    function showPair() {
      task += 1;
      count.textContent = "Choice task " + task;
      var pair = randomPair();
      box.innerHTML = "";
      pair.forEach(function (trip, t) {
        var card = el("button", "cbc-card");
        card.type = "button";
        card.appendChild(el("h3", null, "Trip " + (t === 0 ? "A" : "B")));
        TRIP_ATTRS.forEach(function (attr, i) {
          var lvl = attr.levels[trip[i]];
          var row = el("div", "cbc-row");
          row.appendChild(el("span", "ic", lvl[0]));
          row.appendChild(el("span", "k", attr.name));
          row.appendChild(el("span", "v" + (trip[i] !== pair[1 - t][i] ? " diff" : ""), lvl[1]));
          card.appendChild(row);
        });
        card.appendChild(el("span", "cbc-pick", "Choose trip " + (t === 0 ? "A" : "B")));
        card.addEventListener("click", function () { choose(t); });
        box.appendChild(card);
      });
    }

    function choose(t) {
      if (busy) return;
      busy = true;
      Array.prototype.forEach.call(box.children, function (c, i) {
        c.classList.add(i === t ? "picked" : "faded");
      });
      setTimeout(function () { busy = false; showPair(); }, 650);
    }

    none.addEventListener("click", function () { choose(-1); });
    showPair();
  }

  window.startConjointTools = function () {
    document.querySelectorAll("[data-cbc]").forEach(mountChoiceTask);
    document.querySelectorAll("[data-accordion]").forEach(mountAccordion);
    document.querySelectorAll("[data-pizza-builder]").forEach(mountPizzaBuilder);
    document.querySelectorAll("[data-conjoint-regression]").forEach(function (r) { shieldKeys(r); mountRegression(r); });
    document.querySelectorAll("[data-choice-rules]").forEach(function (r) { shieldKeys(r); mountChoiceRules(r); });
  };
})();
