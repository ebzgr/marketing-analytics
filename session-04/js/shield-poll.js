/**
 * Shield of Eden in-class poll: QR link + live Yes/No tallies.
 *
 * Responses are read from a local proxy (never put OAuth tokens in the deck):
 *   node scripts/shield-poll-server.js
 * which serves GET /api/shield-poll using the instructor's Google Forms token.
 * POST /api/shield-poll/clear resets the live tally (ignores older responses).
 */
(function () {
  var DEFAULT_API = "http://127.0.0.1:8791/api/shield-poll";

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function $all(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function emptyTally() {
    return {
      total: 0,
      eligible: 0,
      chrome: { yes: 0, no: 0 },
      share: { yes: 0, no: 0 },
      reward: { yes: 0, no: 0 },
    };
  }

  function paintCard(card, counts) {
    var total = Math.max(1, (counts.yes || 0) + (counts.no || 0));
    ["yes", "no"].forEach(function (key) {
      var n = counts[key] || 0;
      var fill = card.querySelector('[data-bar="' + key + '"]');
      var label = card.querySelector('[data-n="' + key + '"]');
      if (fill) fill.style.width = ((100 * n) / total).toFixed(1) + "%";
      if (label) label.textContent = String(n);
    });
  }

  function paint(tally) {
    tally = tally || emptyTally();
    $all("[data-shield-count]").forEach(function (el) {
      el.textContent = String(tally.total || 0);
    });
    var eligible = $("[data-shield-eligible]");
    var total = $("[data-shield-total]");
    if (eligible) eligible.textContent = String(tally.eligible || 0);
    if (total) total.textContent = String(tally.total || 0);

    ["chrome", "share", "reward"].forEach(function (key) {
      var card = document.querySelector('[data-shield-q="' + key + '"]');
      if (card) paintCard(card, tally[key] || { yes: 0, no: 0 });
    });
  }

  function wireFormLink(root) {
    var url = (root.getAttribute("data-form-url") || "").trim();
    var link = $("[data-shield-form-link]", root);
    var qr = $("[data-shield-qr]", root);
    if (url) {
      if (link) {
        link.href = url;
        link.hidden = false;
      }
      if (qr) {
        qr.hidden = false;
        qr.src =
          "https://api.qrserver.com/v1/create-qr-code/?size=480x480&margin=16&data=" +
          encodeURIComponent(url);
      }
    } else {
      if (link) link.hidden = true;
      if (qr) qr.hidden = true;
    }
  }

  function apiUrl(root) {
    return (
      (root && root.getAttribute("data-responses-api")) ||
      DEFAULT_API
    ).trim();
  }

  function clearUrl(root) {
    var base = apiUrl(root).replace(/\/?$/, "");
    return base + "/clear";
  }

  async function refresh(root) {
    var url = apiUrl(root);
    if (!url) {
      paint(emptyTally());
      return;
    }
    try {
      var res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      var data = await res.json();
      paint(data);
    } catch (err) {
      paint(emptyTally());
      var note = $("[data-shield-eligible]");
      if (note) {
        note.parentElement.title =
          "Could not reach the local poll proxy. Run: node scripts/shield-poll-server.js";
      }
    }
  }

  async function deleteResults(root) {
    var ok = window.confirm(
      "Clear the live poll tallies for class? Older Google Form responses will be ignored until new ones arrive."
    );
    if (!ok) return;
    try {
      var res = await fetch(clearUrl(root), {
        method: "POST",
        cache: "no-store",
      });
      var data = await res.json().catch(function () {
        return null;
      });
      if (!res.ok || !data || data.ok === false) {
        throw new Error((data && data.error) || "Clear failed (" + res.status + ")");
      }
      paint(data.summary || emptyTally());
    } catch (err) {
      window.alert("Delete failed: " + (err.message || err));
    }
  }

  function mount() {
    var poll = $("[data-shield-poll]");
    var results = $("[data-shield-results]");
    if (!poll && !results) return;

    if (poll) wireFormLink(poll);
    var apiRoot = poll || results;

    $all("[data-shield-refresh]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        refresh(apiRoot);
      });
    });

    $all("[data-shield-delete]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        deleteResults(apiRoot);
      });
    });

    function onShow() {
      if (typeof Reveal === "undefined") return;
      var idx = Reveal.getIndices().h;
      var sections = Array.prototype.slice.call(
        document.querySelectorAll(".reveal .slides > section")
      );
      var pollIdx = sections.indexOf(poll);
      var resultsIdx = sections.indexOf(results);
      if (idx === pollIdx || idx === resultsIdx) refresh(apiRoot);
    }

    refresh(apiRoot);
    if (typeof Reveal !== "undefined") {
      Reveal.on("slidechanged", onShow);
    }
    setInterval(function () {
      if (typeof Reveal === "undefined") return;
      var idx = Reveal.getIndices().h;
      var sections = Array.prototype.slice.call(
        document.querySelectorAll(".reveal .slides > section")
      );
      if (sections[idx] === poll || sections[idx] === results) {
        refresh(apiRoot);
      }
    }, 8000);
  }

  window.startShieldPoll = function () {
    if (window.__shieldPollStarted) return;
    window.__shieldPollStarted = true;
    mount();
  };
})();
