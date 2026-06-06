/**
 * SilentTube — content.js
 * ─────────────────────────────────────────────────────────────────
 * Content script injected into every YouTube page.
 * Responsibilities:
 *   1. Read settings from Chrome Storage
 *   2. Apply CSS class tokens on <html> to activate CSS rules in content.css
 *   3. Run a MutationObserver to handle YouTube's SPA navigation and
 *      dynamic DOM inserts (YouTube is a Single Page App — elements are
 *      added/replaced without a full page reload)
 *   4. Handle additional JS-based blocking that CSS alone cannot do
 *      (e.g., programmatic autoplay, home-feed redirect)
 *   5. Listen for messages from popup.js for live setting updates
 *   6. Track session statistics (focus time, pages visited)
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';

// ─── Constants ──────────────────────────────────────────────────

/** CSS class prefix applied to <html> to activate content.css rules */
const CLS = 'silentTube-';

/** Default settings matching popup.js defaults */
const DEFAULT_SETTINGS = {
  enabled: true,
  hideShorts: true,
  hideRecommended: true,
  hideHome: false,
  hideComments: false,
  hideTrending: true,
  hideEndscreen: true,
  hideAutoplay: true,
  focusMode: false,
  studyMode: false,
  whitelistedChannels: [],
  sessionTimer: 0, // minutes; 0 = disabled
};

// ─── State ───────────────────────────────────────────────────────
let settings = { ...DEFAULT_SETTINGS };
let observer = null;
let sessionStartTime = null;
let statsInterval = null;

// ─── Initialisation ──────────────────────────────────────────────

/**
 * Entry point. Loads settings then starts watching the page.
 */
async function init() {
  settings = await loadSettings();
  applyAllSettings();
  startObserver();
  startSessionTracking();
  listenForMessages();
}

/**
 * Reads settings from chrome.storage.sync, falling back to defaults.
 * @returns {Promise<Object>}
 */
async function loadSettings() {
  return new Promise(resolve => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, data => {
      resolve({ ...DEFAULT_SETTINGS, ...data });
    });
  });
}

// ─── CSS Class Application ───────────────────────────────────────

/**
 * Maps setting keys → CSS class suffixes used in content.css.
 * Class format: silentTube-hide-<suffix>
 */
const SETTING_CLASS_MAP = {
  hideShorts:      'shorts',
  hideRecommended: 'recommended',
  hideHome:        'home',
  hideComments:    'comments',
  hideTrending:    'trending',
  hideEndscreen:   'endscreen',
  hideAutoplay:    'autoplay',
};

/**
 * Applies (or removes) all CSS token classes on <html> based on
 * current settings. Fast — just class list mutations, no DOM queries.
 */
function applyAllSettings() {
  const html = document.documentElement;

  // If the extension is disabled globally, strip everything and bail
  if (!settings.enabled) {
    Object.values(SETTING_CLASS_MAP).forEach(suffix => {
      html.classList.remove(`${CLS}hide-${suffix}`);
    });
    return;
  }

  Object.entries(SETTING_CLASS_MAP).forEach(([key, suffix]) => {
    const active = settings.focusMode || settings[key];
    html.classList.toggle(`${CLS}hide-${suffix}`, !!active);
  });

  // Study mode: dim non-video areas with a CSS variable
  html.classList.toggle(`${CLS}study-mode`, !!settings.studyMode);

  // Handle home-feed redirect (CSS hides the grid but user still lands there)
  handleHomeFeed();

  // Handle autoplay toggle via YouTube's own button
  handleAutoplayButton();
}

/**
 * Applies a single updated setting without re-running everything.
 * Called on live updates from the popup.
 * @param {string} key
 * @param {*} value
 */
function applySetting(key, value) {
  settings[key] = value;
  applyAllSettings();
}

// ─── Home Feed Handler ───────────────────────────────────────────

/**
 * If hideHome is active and the user is on youtube.com or /feed/subscriptions
 * we redirect them to /feed/subscriptions (or show a custom overlay).
 * We don't redirect mid-video.
 */
function handleHomeFeed() {
  if (!(settings.hideHome || settings.focusMode)) return;

  const path = location.pathname;
  if (path === '/' || path === '/feed/trending') {
    // Show subscriptions instead of home / trending
    if (!document.getElementById('silentTube-home-overlay')) {
      injectHomeOverlay();
    }
  } else {
    removeHomeOverlay();
  }
}

function injectHomeOverlay() {
  const el = document.createElement('div');
  el.id = 'silentTube-home-overlay';
  el.innerHTML = `
    <div class="st-overlay-inner">
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
          stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <h2>Focus Mode Active</h2>
      <p>The home feed is hidden to keep you focused.<br>
         Head to your <a href="/feed/subscriptions">Subscriptions</a> or search for something specific.</p>
    </div>
  `;
  // Overlay styles injected inline so they survive any page changes
  const style = `
    #silentTube-home-overlay {
      position: fixed; inset: 0; z-index: 9999;
      background: #0a0a0a;
      display: flex; align-items: center; justify-content: center;
      font-family: 'YouTube Sans', sans-serif; color: #e0e0e0;
    }
    .st-overlay-inner { text-align: center; max-width: 420px; padding: 2rem; }
    .st-overlay-inner svg { width: 56px; height: 56px; margin-bottom: 1.5rem; color: #ff4444; }
    .st-overlay-inner h2 { font-size: 1.75rem; font-weight: 700; margin: 0 0 .75rem; }
    .st-overlay-inner p  { font-size: 1rem; color: #888; line-height: 1.6; }
    .st-overlay-inner a  { color: #ff4444; text-decoration: none; }
    .st-overlay-inner a:hover { text-decoration: underline; }
  `;
  const styleEl = document.createElement('style');
  styleEl.id = 'silentTube-overlay-style';
  styleEl.textContent = style;
  document.head.appendChild(styleEl);
  document.body.appendChild(el);
}

function removeHomeOverlay() {
  document.getElementById('silentTube-home-overlay')?.remove();
  document.getElementById('silentTube-overlay-style')?.remove();
}

// ─── Autoplay Button Handler ─────────────────────────────────────

/**
 * YouTube's autoplay toggle is a button in the player. We click it
 * programmatically when the user wants autoplay disabled.
 * We check the button's aria-checked state so we don't double-toggle.
 */
function handleAutoplayButton() {
  const btn = document.querySelector('.ytp-autonav-toggle-button');
  if (!btn) return; // Not on a video page yet

  const isOn = btn.getAttribute('aria-checked') === 'true';
  const shouldBeOff = settings.hideAutoplay || settings.focusMode;

  if (shouldBeOff && isOn) {
    btn.click();
  } else if (!shouldBeOff && !isOn) {
    // Only turn it back on if we explicitly turned it off before
    // (don't override user's manual preference when filter is off)
  }
}

// ─── Channel Whitelist ───────────────────────────────────────────

/**
 * Returns true if the current page's channel is whitelisted.
 * If whitelisted, all blocking is suspended on this page.
 */
function isChannelWhitelisted() {
  if (!settings.whitelistedChannels || settings.whitelistedChannels.length === 0) return false;

  // Try to read the channel name from the page
  const channelLink = document.querySelector(
    '#channel-name a, ytd-channel-name a, #owner-name a, .ytd-video-owner-renderer a'
  );
  if (!channelLink) return false;

  const channelName = channelLink.textContent.trim().toLowerCase();
  return settings.whitelistedChannels.some(
    ch => channelName.includes(ch.toLowerCase())
  );
}

// ─── MutationObserver ────────────────────────────────────────────

/**
 * YouTube is a Single Page Application. When the user navigates,
 * the DOM is mutated rather than a full page load occurring.
 * We watch for:
 *   - URL changes (yt-navigate-finish event + popstate)
 *   - New nodes being added (to catch dynamic content like autoplay btn)
 */
function startObserver() {
  // Throttle: don't fire more than once per animation frame
  let rafPending = false;

  const onMutation = () => {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      if (!settings.enabled) return;
      if (isChannelWhitelisted()) return;
      handleAutoplayButton();
      handleHomeFeed();
    });
  };

  observer = new MutationObserver(onMutation);
  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });

  // YouTube fires this custom event on SPA navigation
  document.addEventListener('yt-navigate-finish', () => {
    applyAllSettings();
  });
}

// ─── Session Tracking ────────────────────────────────────────────

/**
 * Tracks how long the extension has been "protecting" the user today.
 * Stats are stored in chrome.storage.local (local, not synced, since
 * they are device-specific).
 */
function startSessionTracking() {
  if (!settings.enabled) return;
  sessionStartTime = Date.now();

  // Flush stats every 60 seconds
  statsInterval = setInterval(flushStats, 60_000);

  // Also flush on tab unload
  window.addEventListener('beforeunload', flushStats);
}

function flushStats() {
  if (!sessionStartTime) return;
  const elapsedMinutes = Math.floor((Date.now() - sessionStartTime) / 60_000);
  if (elapsedMinutes < 1) return;

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  chrome.storage.local.get({ stats: {} }, ({ stats }) => {
    stats[today] = (stats[today] || 0) + elapsedMinutes;
    chrome.storage.local.set({ stats });
  });

  // Reset so we don't double-count
  sessionStartTime = Date.now();
}

// ─── Session Timer (countdown) ───────────────────────────────────

let sessionTimerTimeout = null;

/**
 * If the user has set a session timer (X minutes), we send a notification
 * via the background service worker when the timer expires.
 */
function startSessionTimer() {
  if (!settings.sessionTimer || settings.sessionTimer <= 0) return;
  clearTimeout(sessionTimerTimeout);
  const ms = settings.sessionTimer * 60_000;
  sessionTimerTimeout = setTimeout(() => {
    chrome.runtime.sendMessage({ type: 'SESSION_TIMER_DONE', minutes: settings.sessionTimer });
  }, ms);
}

// ─── Message Listener ────────────────────────────────────────────

/**
 * Listens for messages from popup.js so settings apply in real-time
 * without requiring a page refresh.
 */
function listenForMessages() {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.type) {
      case 'SETTINGS_UPDATED':
        settings = { ...settings, ...msg.settings };
        applyAllSettings();
        sendResponse({ ok: true });
        break;

      case 'GET_STATS': {
        const today = new Date().toISOString().slice(0, 10);
        chrome.storage.local.get({ stats: {} }, ({ stats }) => {
          sendResponse({ stats, today: stats[today] || 0 });
        });
        return true; // keep channel open for async response
      }

      case 'START_TIMER':
        settings.sessionTimer = msg.minutes;
        startSessionTimer();
        sendResponse({ ok: true });
        break;

      default:
        break;
    }
  });
}

// ─── Boot ────────────────────────────────────────────────────────
init();
