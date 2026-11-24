/**
 * Shared helpers for Marketing Analytics reveal.js decks.
 * Theme toggle: light / dark, persisted in localStorage.
 */
(function () {
  const STORAGE_KEY = "ma-slides-theme";

  function preferredTheme() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_KEY, theme);
    const btn = document.getElementById("theme-toggle");
    if (btn) {
      const isDark = theme === "dark";
      btn.setAttribute("aria-pressed", String(isDark));
      btn.setAttribute(
        "aria-label",
        isDark ? "Switch to light mode" : "Switch to dark mode"
      );
      btn.title = isDark ? "Light mode" : "Dark mode";
    }
  }

  function ensureToggle() {
    if (document.getElementById("theme-toggle")) return;
    const btn = document.createElement("button");
    btn.id = "theme-toggle";
    btn.type = "button";
    btn.className = "theme-toggle";
    btn.innerHTML =
      '<span class="theme-toggle-icon theme-toggle-icon-sun" aria-hidden="true">☀</span>' +
      '<span class="theme-toggle-icon theme-toggle-icon-moon" aria-hidden="true">☾</span>';
    btn.addEventListener("click", function () {
      const next =
        document.documentElement.getAttribute("data-theme") === "dark"
          ? "light"
          : "dark";
      applyTheme(next);
    });
    document.body.appendChild(btn);
  }

  function init() {
    applyTheme(preferredTheme());
    ensureToggle();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.MASlides = window.MASlides || {};
  window.MASlides.setTheme = applyTheme;
})();
