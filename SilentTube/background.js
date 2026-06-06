/**
 * SilentTube — background.js
 * ─────────────────────────────────────────────────────────────────
 * Manifest V3 Service Worker (replaces background pages from MV2).
 *
 * Responsibilities:
 *   1. Handle keyboard shortcut commands (Alt+Shift+F, Alt+Shift+S)
 *   2. Relay session-timer notifications from content script
 *   3. Handle daily stats reset via alarms
 *   4. Badge icon updates to show extension state
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';

// ─── Keyboard Shortcut Commands ──────────────────────────────────

chrome.commands.onCommand.addListener(async command => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  if (command === 'toggle-focus-mode') {
    // Read current focusMode, flip it, save, and notify content script
    chrome.storage.sync.get({ focusMode: false }, ({ focusMode }) => {
      const newVal = !focusMode;
      chrome.storage.sync.set({ focusMode: newVal }, () => {
        chrome.tabs.sendMessage(tab.id, {
          type: 'SETTINGS_UPDATED',
          settings: { focusMode: newVal },
        }).catch(() => {}); // Tab may not be a YouTube page — ignore
      });
    });
  }

  if (command === 'toggle-extension') {
    chrome.storage.sync.get({ enabled: true }, ({ enabled }) => {
      const newVal = !enabled;
      chrome.storage.sync.set({ enabled: newVal }, () => {
        updateBadge(newVal);
        chrome.tabs.sendMessage(tab.id, {
          type: 'SETTINGS_UPDATED',
          settings: { enabled: newVal },
        }).catch(() => {});
      });
    });
  }
});

// ─── Message Relay ────────────────────────────────────────────────

/**
 * Content script sends SESSION_TIMER_DONE when the countdown finishes.
 * We show a Chrome notification here (service worker is the right place
 * for notifications in MV3).
 */
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'SESSION_TIMER_DONE') {
    showNotification(
      'Study Session Complete 🎉',
      `You stayed focused for ${msg.minutes} minute${msg.minutes !== 1 ? 's' : ''}. Take a well-earned break!`
    );
  }
});

// ─── Notifications ────────────────────────────────────────────────

function showNotification(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'assets/icon128.png',
    title,
    message,
    priority: 2,
  });
}

// ─── Badge ────────────────────────────────────────────────────────

/**
 * Shows a small badge on the extension icon so the user can quickly
 * see if SilentTube is active (no badge) or paused ("OFF").
 */
function updateBadge(enabled) {
  if (enabled) {
    chrome.action.setBadgeText({ text: '' });
  } else {
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#888888' });
  }
}

// ─── Alarms: Daily Stats Reset ───────────────────────────────────

/**
 * Set a daily alarm at midnight to prune old stats (keep last 30 days).
 */
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('dailyStatsCleanup', {
    when: getMidnightTimestamp(),
    periodInMinutes: 24 * 60,
  });

  // Set initial badge state
  chrome.storage.sync.get({ enabled: true }, ({ enabled }) => updateBadge(enabled));
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'dailyStatsCleanup') {
    pruneOldStats();
  }
});

/**
 * Removes stat entries older than 30 days to keep storage tidy.
 */
function pruneOldStats() {
  chrome.storage.local.get({ stats: {} }, ({ stats }) => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const pruned = Object.fromEntries(
      Object.entries(stats).filter(([date]) => date >= cutoffStr)
    );
    chrome.storage.local.set({ stats: pruned });
  });
}

function getMidnightTimestamp() {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

// ─── Storage change → badge sync ─────────────────────────────────

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.enabled) {
    updateBadge(changes.enabled.newValue);
  }
});
