/**
 * SilentTube — popup.js
 * ─────────────────────────────────────────────────────────────────
 * Controls the extension popup UI.
 *
 * Responsibilities:
 *   1. Load settings from chrome.storage.sync and populate UI
 *   2. Persist every toggle/select change immediately
 *   3. Broadcast changes to the active YouTube tab (live update)
 *   4. Manage channel whitelist (add / remove)
 *   5. Run the in-popup session countdown timer
 *   6. Render focus statistics (today / week / total + 7-day chart)
 *   7. Export / Import / Reset settings as JSON
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';

// ─── Default Settings ────────────────────────────────────────────
const DEFAULTS = {
  enabled:             true,
  hideShorts:          true,
  hideRecommended:     true,
  hideHome:            false,
  hideComments:        false,
  hideTrending:        true,
  hideEndscreen:       true,
  hideAutoplay:        true,
  focusMode:           false,
  studyMode:           false,
  whitelistedChannels: [],
  sessionTimer:        0,
};

// ─── DOM References ───────────────────────────────────────────────
const $ = id => document.getElementById(id);

const els = {
  version:        $('ext-version'),
  enabled:        $('toggle-enabled'),
  focusBanner:    $('focus-banner'),
  focus:          $('toggle-focus'),
  bodyWrap:       $('body-wrap'),
  // Blockers
  shorts:         $('toggle-shorts'),
  recommended:    $('toggle-recommended'),
  home:           $('toggle-home'),
  comments:       $('toggle-comments'),
  trending:       $('toggle-trending'),
  endscreen:      $('toggle-endscreen'),
  autoplay:       $('toggle-autoplay'),
  // Study
  study:          $('toggle-study'),
  timerSelect:    $('timer-select'),
  timerStart:     $('timer-start'),
  countdownRow:   $('countdown-row'),
  countdownDisp:  $('countdown-display'),
  timerCancel:    $('timer-cancel'),
  // Whitelist
  whitelistInput: $('whitelist-input'),
  whitelistAdd:   $('whitelist-add'),
  whitelistList:  $('whitelist-list'),
  // Stats
  statToday:      $('stat-today'),
  statWeek:       $('stat-week'),
  statTotal:      $('stat-total'),
  statsBarWrap:   $('stats-bar-wrap'),
  // Settings
  btnExport:      $('btn-export'),
  btnImport:      $('btn-import'),
  btnReset:       $('btn-reset'),
  importFile:     $('import-file'),
};

// ─── State ───────────────────────────────────────────────────────
let settings = { ...DEFAULTS };
let countdownInterval = null;
let countdownEnd = null;

// ─── Boot ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  setVersion();
  settings = await loadSettings();
  renderUI();
  loadStats();
  attachListeners();
});

// ─── Version ─────────────────────────────────────────────────────
function setVersion() {
  const manifest = chrome.runtime.getManifest();
  els.version.textContent = `v${manifest.version}`;
}

// ─── Storage ─────────────────────────────────────────────────────

function loadSettings() {
  return new Promise(resolve => {
    chrome.storage.sync.get(DEFAULTS, data => resolve({ ...DEFAULTS, ...data }));
  });
}

/**
 * Saves the current settings object and broadcasts to the active tab.
 */
async function saveSettings() {
  await chrome.storage.sync.set(settings);
  broadcastToActiveTab({ type: 'SETTINGS_UPDATED', settings });
}

async function broadcastToActiveTab(msg) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url?.includes('youtube.com')) {
      chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
    }
  } catch (_) {}
}

// ─── Render UI from Settings ─────────────────────────────────────
function renderUI() {
  // Master toggle
  els.enabled.checked = settings.enabled;
  els.bodyWrap.classList.toggle('disabled', !settings.enabled);

  // Focus mode
  els.focus.checked = settings.focusMode;
  els.focusBanner.classList.toggle('active', settings.focusMode);

  // Blocker toggles
  els.shorts.checked      = settings.hideShorts;
  els.recommended.checked = settings.hideRecommended;
  els.home.checked        = settings.hideHome;
  els.comments.checked    = settings.hideComments;
  els.trending.checked    = settings.hideTrending;
  els.endscreen.checked   = settings.hideEndscreen;
  els.autoplay.checked    = settings.hideAutoplay;

  // Study
  els.study.checked = settings.studyMode;

  // Timer
  const timerVal = settings.sessionTimer || 0;
  els.timerSelect.value = timerVal;

  // Whitelist
  renderWhitelist();
}

// ─── Event Listeners ─────────────────────────────────────────────
function attachListeners() {

  // Master enable/disable
  els.enabled.addEventListener('change', () => {
    settings.enabled = els.enabled.checked;
    els.bodyWrap.classList.toggle('disabled', !settings.enabled);
    saveSettings();
  });

  // Focus Mode
  els.focus.addEventListener('change', () => {
    settings.focusMode = els.focus.checked;
    els.focusBanner.classList.toggle('active', settings.focusMode);
    saveSettings();
  });

  // Individual blockers — map toggle id → settings key
  const blockerMap = {
    'toggle-shorts':      'hideShorts',
    'toggle-recommended': 'hideRecommended',
    'toggle-home':        'hideHome',
    'toggle-comments':    'hideComments',
    'toggle-trending':    'hideTrending',
    'toggle-endscreen':   'hideEndscreen',
    'toggle-autoplay':    'hideAutoplay',
  };
  Object.entries(blockerMap).forEach(([id, key]) => {
    $(id).addEventListener('change', e => {
      settings[key] = e.target.checked;
      saveSettings();
    });
  });

  // Study mode
  els.study.addEventListener('change', () => {
    settings.studyMode = els.study.checked;
    saveSettings();
  });

  // Session timer: start
  els.timerStart.addEventListener('click', () => {
    const minutes = parseInt(els.timerSelect.value, 10);
    if (!minutes) return;
    startCountdown(minutes);
    broadcastToActiveTab({ type: 'START_TIMER', minutes });
  });

  // Session timer: cancel
  els.timerCancel.addEventListener('click', cancelCountdown);

  // Whitelist: add on button click
  els.whitelistAdd.addEventListener('click', addWhitelistEntry);

  // Whitelist: add on Enter key
  els.whitelistInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') addWhitelistEntry();
  });

  // Export / Import / Reset
  els.btnExport.addEventListener('click', exportSettings);
  els.btnImport.addEventListener('click', () => els.importFile.click());
  els.importFile.addEventListener('change', importSettings);
  els.btnReset.addEventListener('click', resetSettings);
}

// ─── Countdown Timer ─────────────────────────────────────────────

/**
 * Starts the in-popup countdown display.
 * @param {number} minutes
 */
function startCountdown(minutes) {
  cancelCountdown();
  countdownEnd = Date.now() + minutes * 60_000;
  els.countdownRow.hidden = false;
  tickCountdown();
  countdownInterval = setInterval(tickCountdown, 1_000);
}

function tickCountdown() {
  const remaining = Math.max(0, countdownEnd - Date.now());
  const mins = Math.floor(remaining / 60_000);
  const secs = Math.floor((remaining % 60_000) / 1_000);
  els.countdownDisp.textContent =
    `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  if (remaining === 0) {
    cancelCountdown();
    els.countdownDisp.textContent = 'Done! 🎉';
    setTimeout(() => { els.countdownRow.hidden = true; }, 3_000);
  }
}

function cancelCountdown() {
  clearInterval(countdownInterval);
  countdownInterval = null;
  countdownEnd = null;
  els.countdownRow.hidden = true;
}

// ─── Channel Whitelist ───────────────────────────────────────────

function addWhitelistEntry() {
  const val = els.whitelistInput.value.trim();
  if (!val) return;

  // Normalise: strip leading @
  const normalised = val.replace(/^@/, '');
  if (settings.whitelistedChannels.includes(normalised)) {
    els.whitelistInput.value = '';
    return;
  }

  settings.whitelistedChannels = [...settings.whitelistedChannels, normalised];
  els.whitelistInput.value = '';
  renderWhitelist();
  saveSettings();
}

function removeWhitelistEntry(channel) {
  settings.whitelistedChannels = settings.whitelistedChannels.filter(c => c !== channel);
  renderWhitelist();
  saveSettings();
}

function renderWhitelist() {
  els.whitelistList.innerHTML = '';
  settings.whitelistedChannels.forEach(ch => {
    const li = document.createElement('li');
    li.className = 'whitelist-item';
    li.innerHTML = `
      <span class="whitelist-item-name">@${ch}</span>
      <button class="whitelist-remove-btn" title="Remove">✕</button>
    `;
    li.querySelector('.whitelist-remove-btn').addEventListener('click', () => {
      removeWhitelistEntry(ch);
    });
    els.whitelistList.appendChild(li);
  });
}

// ─── Statistics ──────────────────────────────────────────────────

async function loadStats() {
  const today = new Date().toISOString().slice(0, 10);

  return new Promise(resolve => {
    chrome.storage.local.get({ stats: {} }, ({ stats }) => {
      const todayMins   = stats[today] || 0;
      const weekMins    = getWeekTotal(stats, today);
      const totalMins   = Object.values(stats).reduce((a, b) => a + b, 0);

      els.statToday.textContent = todayMins;
      els.statWeek.textContent  = weekMins;
      els.statTotal.textContent = totalMins;

      renderBarChart(stats, today);
      resolve();
    });
  });
}

/**
 * Sums the last 7 days of stats.
 */
function getWeekTotal(stats, today) {
  let total = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    total += stats[d.toISOString().slice(0, 10)] || 0;
  }
  return total;
}

/**
 * Renders a simple 7-bar chart for the last 7 days.
 */
function renderBarChart(stats, today) {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key   = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString('en', { weekday: 'narrow' });
    days.push({ key, label, value: stats[key] || 0 });
  }

  const maxVal = Math.max(...days.map(d => d.value), 1);
  els.statsBarWrap.innerHTML = '';

  days.forEach(({ key, label, value }) => {
    const bar = document.createElement('div');
    bar.className = 'stats-bar' + (key === today ? ' today' : '');
    const pct = Math.max((value / maxVal) * 100, value > 0 ? 8 : 4);
    bar.style.height = `${pct}%`;
    bar.title = `${label}: ${value} min`;
    bar.innerHTML = `<span class="stats-bar-label">${label}</span>`;
    els.statsBarWrap.appendChild(bar);
  });
}

// ─── Export / Import / Reset ─────────────────────────────────────

function exportSettings() {
  const blob = new Blob(
    [JSON.stringify(settings, null, 2)],
    { type: 'application/json' }
  );
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `silenttube-settings-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importSettings(e) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text   = await file.text();
    const parsed = JSON.parse(text);

    // Validate: only accept known keys
    const merged = { ...DEFAULTS };
    Object.keys(DEFAULTS).forEach(key => {
      if (key in parsed) merged[key] = parsed[key];
    });

    settings = merged;
    await saveSettings();
    renderUI();
    loadStats();
  } catch (err) {
    alert('Invalid settings file. Please use a file exported by SilentTube.');
  } finally {
    els.importFile.value = '';
  }
}

async function resetSettings() {
  if (!confirm('Reset all SilentTube settings to defaults?')) return;
  settings = { ...DEFAULTS };
  await saveSettings();
  renderUI();
}
