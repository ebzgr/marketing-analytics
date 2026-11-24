/**
 * Session 7: live programmatic auction ([data-auction]).
 *
 * Impressions arrive one after another. For each impression, three advertisers
 *   1. predict the probability that this user clicks their ad (using the data they have),
 *   2. bid  Pr(click) x value of a click  (the expected value of this one impression, in euros),
 * and the highest bid wins. The winner pays the runner-up's bid (second-price auction),
 * so bidding your true expected value is optimal and better predictions mean more profit.
 * The ad is shown on the phone and the user clicks with the TRUE probability.
 *
 * Every advertiser predicts from the app, the hour and the user's history with its brand.
 * Numbers are illustrative (CTRs are inflated so that clicks are visible in class).
 */
(function () {
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function eur(x, d) {
    var s = Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
    return (x < 0 ? "−€" : "€") + s;
  }

  function pct(x, d) { return (100 * x).toFixed(d == null ? 1 : d) + "%"; }

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

  /* ----- The market ----- */
  var APPS = [
    { cat: "Games", emoji: "🕹️", name: "Puzzle game app" },
    { cat: "Sports", emoji: "⚽", name: "Sports scores app" },
    { cat: "Travel", emoji: "🗺️", name: "Travel guide app" },
    { cat: "News", emoji: "📰", name: "News app" }
  ];

  var ADV = [
    { key: "A", emoji: "✈️", name: "Travel agency", likes: "Travel", value: 1.2, data: "ctx",
      ad: "✈️ Weekend in Lisbon −30%", cta: "Book now", hist: "✈️ Booked a trip recently" },
    { key: "B", emoji: "👟", name: "Sportswear", likes: "Sports", value: 0.9, data: "beh",
      ad: "👟 New running shoes", cta: "Shop the drop", hist: "👟 Browsed sneakers" },
    { key: "C", emoji: "🎮", name: "Mobile game", likes: "Games", value: 1.0, data: "beh",
      ad: "🎮 Tap Kingdom", cta: "Play free now", hist: "🎮 Plays similar games" }
  ];


  var BASE = 0.02, MATCH = 3, EVENING = 1.3, HIST = 5, P_HIST = 0.2;
  var AVG_MATCH = 0.25 * MATCH + 0.75;
  var AVG_EVENING = (5 * EVENING + 19) / 24;
  var AVG_HIST = (1 - P_HIST) + P_HIST * HIST;

  function isEvening(h) { return h >= 19 && h <= 23; }

  function drawImpression(r, id) {
    var imp = { id: id, app: APPS[Math.floor(r() * APPS.length)], hour: Math.floor(r() * 24), hist: {}, noise: {} };
    ADV.forEach(function (a) {
      imp.hist[a.key] = r() < P_HIST;
      imp.noise[a.key] = Math.exp(0.3 * normal(r) - 0.045);
    });
    return imp;
  }

  function predict(imp, a, mode) {
    if (mode === "none") return BASE * AVG_MATCH * AVG_EVENING * AVG_HIST;
    var p = BASE * (imp.app.cat === a.likes ? MATCH : 1) * (isEvening(imp.hour) ? EVENING : 1);
    return mode === "ctx" ? p * AVG_HIST : p * (imp.hist[a.key] ? HIST : 1);
  }

  function trueCtr(imp, a) {
    return Math.min(0.6, predict(imp, a, "beh") * imp.noise[a.key]);
  }

  function mountAuction(root) {
    var impBox = root.querySelector("[data-ax-imp]");
    var queueBox = root.querySelector("[data-ax-queue]");
    var lanesBox = root.querySelector("[data-ax-lanes]");
    var phone = root.querySelector("[data-ax-phone]");
    var scoreBox = root.querySelector("[data-ax-score]");
    var playBtn = root.querySelector("[data-ax-play]");
    var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var r = rng(2024), nextId = 48213, queue = [], stats, timers = [], loop = null;
    var playing = !reduced, visible = false;

    function mode() { return "beh"; }

    function resetStats() {
      stats = {};
      ADV.forEach(function (a) { stats[a.key] = { won: 0, clicks: 0, spend: 0, value: 0 }; });
      stats.total = 0;
    }

    function refill() {
      while (queue.length < 4) queue.push(drawImpression(r, nextId++));
    }

    /* Lanes are built once; each auction only updates their numbers. */
    var lanes = {};
    ADV.forEach(function (a) {
      var lane = el("div", "ax-lane");
      var av = el("div", "ax-avatar", a.emoji);
      var body = el("div");
      var head = el("div", "ax-head");
      head.appendChild(el("b", null, a.key + " · " + a.name + (a.key === "C" ? " (you)" : "")));
      head.appendChild(el("span", null, eur(a.value, 2) + " per click"));
      var calc = el("div", "ax-calc", " ");
      var bar = el("div", "ax-bar");
      var track = el("div", "ax-track");
      var fill = el("span", "ax-fill");
      track.appendChild(fill);
      var bid = el("span", "ax-bid", "–");
      bar.appendChild(track);
      bar.appendChild(bid);
      body.appendChild(head);
      body.appendChild(calc);
      body.appendChild(bar);
      lane.appendChild(av);
      lane.appendChild(body);
      lanesBox.appendChild(lane);
      lanes[a.key] = { lane: lane, calc: calc, fill: fill, bid: bid };
    });

    function renderImpression(imp) {
      impBox.innerHTML = "";
      impBox.classList.remove("enter");
      void impBox.offsetWidth;
      impBox.classList.add("enter");
      var user = el("div", "ax-user");
      user.appendChild(el("span", "ax-emoji", imp.app.emoji));
      var who = el("div");
      who.appendChild(el("b", null, imp.app.name));
      who.appendChild(el("small", null, "User #" + imp.id + " · " + String(imp.hour).padStart(2, "0") + ":00"));
      user.appendChild(who);
      impBox.appendChild(user);
      var chips = el("div", "ax-chips");
      chips.appendChild(el("span", "chip", "Context: " + imp.app.cat + (isEvening(imp.hour) ? " · evening" : "")));
      var any = false;
      ADV.forEach(function (a) {
        if (imp.hist[a.key]) { chips.appendChild(el("span", "chip warm", a.hist)); any = true; }
      });
      if (!any) chips.appendChild(el("span", "chip", "No relevant history"));
      impBox.appendChild(chips);

      queueBox.innerHTML = "";
      queue.slice(0, 3).forEach(function (q) {
        var row = el("div", "ax-q");
        row.appendChild(el("span", null, q.app.emoji));
        row.appendChild(el("span", null, q.app.name + " · " + String(q.hour).padStart(2, "0") + ":00"));
        queueBox.appendChild(row);
      });
    }

    function renderPhone(imp, winner, result) {
      phone.innerHTML = "";
      var app = el("div", "ax-app");
      app.appendChild(el("span", null, imp.app.emoji));
      app.appendChild(el("span", null, imp.app.name));
      phone.appendChild(app);
      ["", "", " short", "", " short"].forEach(function (c) { phone.appendChild(el("div", "ax-line" + c)); });
      if (winner) {
        var ad = el("div", "ax-ad", winner.ad);
        ad.appendChild(el("small", null, winner.cta + " · Ad by " + winner.key));
        phone.appendChild(ad);
      }
      if (result != null) {
        phone.appendChild(el("div", "ax-result " + (result ? "click" : "miss"), result ? "👆 Click! +" + eur(winner.value, 2) : "Scrolled past"));
      }
    }

    function auction(imp) {
      var best = null;
      var bids = ADV.map(function (a) {
        var p = predict(imp, a, mode(a));
        var b = { a: a, p: p, bid: p * a.value };
        if (!best || b.bid > best.bid) best = b;
        return b;
      });
      var second = 0;
      bids.forEach(function (b) { if (b !== best && b.bid > second) second = b.bid; });
      return { bids: bids, win: best, price: second };
    }

    function record(res, clicked) {
      var s = stats[res.win.a.key];
      s.won++;
      s.spend += res.price;
      if (clicked) { s.clicks++; s.value += res.win.a.value; }
      stats.total++;
    }

    function renderScore() {
      scoreBox.innerHTML = "";
      var revenue = 0;
      ADV.forEach(function (a) {
        var s = stats[a.key];
        revenue += s.spend;
        var tr = el("tr", a.key === "C" ? "you" : null);
        tr.appendChild(el("td", "left", a.emoji + " " + a.key + " · " + a.name + (a.key === "C" ? " (you)" : "")));
        tr.appendChild(el("td", null, s.won + (stats.total ? " (" + Math.round(100 * s.won / stats.total) + "%)" : "")));
        tr.appendChild(el("td", null, String(s.clicks)));
        tr.appendChild(el("td", null, s.won ? pct(s.clicks / s.won) : "–"));
        tr.appendChild(el("td", null, eur(s.spend, 2)));
        var profit = s.value - s.spend;
        tr.appendChild(el("td", s.won ? (profit >= 0 ? "pos" : "neg") : null, s.won ? eur(profit, 2) : "–"));
        scoreBox.appendChild(tr);
      });
      var tr = el("tr");
      var td = el("td", "left", "🏦 Ad network revenue: " + eur(revenue, 2) + " from " + stats.total.toLocaleString("en-US") + " auctions");
      td.colSpan = 6;
      tr.appendChild(td);
      scoreBox.appendChild(tr);
    }

    function clearTimers() {
      timers.forEach(clearTimeout);
      timers = [];
    }

    function step() {
      clearTimers();
      refill();
      var imp = queue.shift();
      refill();
      var res = auction(imp);
      var clicked = r() < trueCtr(imp, res.win.a);

      renderImpression(imp);
      renderPhone(imp, null, null);
      ADV.forEach(function (a) {
        var L = lanes[a.key];
        L.lane.classList.remove("win");
        L.fill.style.width = "0%";
        L.bid.textContent = "…";
        L.calc.textContent = "predicting…";
      });

      timers.push(setTimeout(function () {
        var max = Math.max.apply(null, res.bids.map(function (b) { return b.bid; })) * 1.08;
        res.bids.forEach(function (b) {
          var L = lanes[b.a.key];
          L.calc.innerHTML = "";
          L.calc.appendChild(document.createTextNode("Pr(click) "));
          L.calc.appendChild(el("strong", null, pct(b.p)));
          L.calc.appendChild(document.createTextNode(" × " + eur(b.a.value, 2) + " per click = bid"));
          L.fill.style.width = (100 * b.bid / max).toFixed(1) + "%";
          L.bid.textContent = eur(b.bid, 3);
        });
      }, 350));

      timers.push(setTimeout(function () {
        var W = lanes[res.win.a.key];
        W.lane.classList.add("win");
        W.calc.appendChild(el("strong", null, " → wins, pays runner-up’s " + eur(res.price, 3)));
        renderPhone(imp, res.win.a, null);
      }, 1150));

      timers.push(setTimeout(function () {
        phone.appendChild(el("div", "ax-result " + (clicked ? "click" : "miss"), clicked ? "👆 Click! +" + eur(res.win.a.value, 2) : "Scrolled past"));
        record(res, clicked);
        renderScore();
      }, 1800));
    }

    function startLoop() {
      stopLoop();
      step();
      loop = setInterval(step, 2800);
    }

    function stopLoop() {
      if (loop) clearInterval(loop);
      loop = null;
    }

    function syncPlay() {
      playBtn.textContent = playing ? "❚❚ Pause" : "▶ Play";
      if (playing && visible) startLoop();
      else stopLoop();
    }

    playBtn.addEventListener("click", function () { playing = !playing; syncPlay(); });
    root.querySelector("[data-ax-step]").addEventListener("click", function () {
      playing = false;
      syncPlay();
      step();
    });
    root.querySelector("[data-ax-ff]").addEventListener("click", function () {
      clearTimers();
      var fr = rng(nextId * 13);
      for (var i = 0; i < 10000; i++) {
        var imp = drawImpression(fr, nextId++);
        var res = auction(imp);
        record(res, fr() < trueCtr(imp, res.win.a));
      }
      renderScore();
    });
    root.querySelector("[data-ax-reset]").addEventListener("click", function () {
      resetStats();
      renderScore();
    });
    // Run only while the slide is on screen.
    function onSlide(e) {
      visible = e.currentSlide === root;
      syncPlay();
    }
    if (window.Reveal) {
      Reveal.on("slidechanged", onSlide);
      Reveal.on("ready", onSlide);
      visible = Reveal.getCurrentSlide && Reveal.getCurrentSlide() === root;
    }

    resetStats();
    refill();
    step();
    renderScore();
    syncPlay();
  }

  window.startAdTools = function () {
    var a = document.querySelector("[data-auction]");
    if (a) mountAuction(a);
  };
})();
