// theme.js — the light/dark toggle button.
//
// The actual switch happens in CSS (base.css defines dark values for every
// colour variable, guarded by prefers-color-scheme and by a [data-theme]
// attribute on <html>). This file only has two jobs:
//   1. Apply whatever was last chosen, immediately, on every page — even
//      ones with no visible toggle button (the exam arenas) — so the theme
//      stays consistent as a student moves around the portal.
//   2. Wire up the toggle button, where one exists, to flip the choice and
//      remember it.
//
// The anti-flash step (setting [data-theme] on <html> BEFORE the page's
// CSS is applied) happens separately, in a tiny inline <script> at the very
// top of each page's <head> — by the time this file runs, that has already
// happened. This file only needs to keep the button's icon/label in sync
// and handle clicks.

const THEME_KEY = 'theme';

function getStoredTheme() {
    try {
        const v = localStorage.getItem(THEME_KEY);
        return (v === 'dark' || v === 'light') ? v : null;
    } catch {
        return null;
    }
}

function systemPrefersDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** The theme actually in effect right now, explicit choice or system default. */
function effectiveTheme() {
    return getStoredTheme() || (systemPrefersDark() ? 'dark' : 'light');
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
}

function setTheme(theme) {
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* storage unavailable — theme still applies for this load */ }
    applyTheme(theme);
    syncToggleButton();
}

function syncToggleButton() {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    const current = effectiveTheme();
    // The icon/label represent what clicking will switch TO.
    if (current === 'dark') {
        btn.textContent = '☀';
        btn.setAttribute('aria-label', 'Switch to light theme');
        btn.title = 'Switch to light theme';
    } else {
        btn.textContent = '☾';
        btn.setAttribute('aria-label', 'Switch to dark theme');
        btn.title = 'Switch to dark theme';
    }
}

// Re-apply immediately in case this page's inline anti-flash snippet was
// missed or the stored value changed in another tab.
applyTheme(effectiveTheme());

document.addEventListener('DOMContentLoaded', () => {
    syncToggleButton();
    const btn = document.getElementById('themeToggle');
    if (btn) {
        btn.addEventListener('click', () => {
            setTheme(effectiveTheme() === 'dark' ? 'light' : 'dark');
        });
    }
});

// Keep every open tab in sync if the theme is changed elsewhere.
window.addEventListener('storage', (e) => {
    if (e.key === THEME_KEY) {
        applyTheme(effectiveTheme());
        syncToggleButton();
    }
});
