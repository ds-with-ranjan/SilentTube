# SilentTube 🔇

> A productivity-focused Chrome Extension that removes YouTube distractions so you can learn without noise.

![Version](https://img.shields.io/badge/version-1.0.0-e63946?style=flat-square)
![Manifest](https://img.shields.io/badge/Manifest-V3-4CAF50?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)

---

## ✨ Features

### Core Blockers
| Feature | What it does |
|---|---|
| **Hide Shorts** | Removes the Shorts shelf from the home page and the Shorts link from the sidebar |
| **Hide Recommended** | Hides the sidebar of suggested videos on watch pages |
| **Hide Home Feed** | Replaces the algorithmic home page with a Focus overlay |
| **Hide Comments** | Removes the comments section from all video pages |
| **Hide Trending** | Removes the Trending tab from the left sidebar |
| **Hide End Screens** | Blocks post-video suggestion overlays that auto-redirect you |
| **Disable Autoplay** | Programmatically disables YouTube's autoplay toggle |

### Focus & Productivity
- **Focus Mode** — One-click button that activates all blockers simultaneously. Also triggerable with `Alt+Shift+F`.
- **Study Mode** — Dims all non-video page content while a video is playing to minimize distraction.
- **Session Timer** — Countdown timer (25 / 45 / 60 / 90 / 120 min) with a browser notification when done.

### Personalisation
- **Channel Whitelist** — Add specific channels by name; SilentTube will bypass all blockers on those pages.
- **Export Settings** — Download your configuration as a JSON file for backup or sharing.
- **Import Settings** — Restore from a previously exported JSON file.
- **Reset All** — Return to factory defaults in one click.

### Statistics
- Minutes of focused YouTube time tracked per day.
- Today / This Week / Total view in the popup.
- 7-day bar chart visualisation.
- Stats stored locally (not synced) and pruned after 30 days automatically.

### Keyboard Shortcuts
| Shortcut | Action |
|---|---|
| `Alt + Shift + F` | Toggle Focus Mode |
| `Alt + Shift + S` | Toggle extension on/off |

---

## 🗂 File Structure

```
SilentTube/
├── manifest.json        # Extension configuration (Manifest V3)
├── content.js           # Injected into YouTube pages; applies blocking rules
├── content.css          # Instant CSS rules applied at document_start
├── background.js        # Service worker: shortcuts, alarms, notifications
├── popup.html           # Popup markup
├── popup.css            # Popup styles (dark mode)
├── popup.js             # Popup logic (settings, stats, whitelist, timer)
├── assets/
│   ├── icon16.png       # Toolbar icon (16×16)
│   ├── icon48.png       # Extensions page icon (48×48)
│   └── icon128.png      # Chrome Web Store icon (128×128)
└── README.md
```

---

## 🚀 Installation (Developer Mode)

1. **Download / Clone** this repository.
   ```bash
   git clone https://github.com/yourname/silenttube.git
   ```

2. Open Chrome and navigate to **`chrome://extensions`**.

3. Enable **Developer mode** (toggle in the top-right corner).

4. Click **"Load unpacked"** and select the `SilentTube/` folder.

5. Pin the extension from the puzzle-piece menu — you'll see the SilentTube icon in your toolbar.

6. Navigate to any YouTube page and enjoy distraction-free browsing! 🎉

---

## ⚙️ How It Works

### Dual-Layer Blocking Strategy

**Layer 1 — Instant CSS (`content.css` + `document_start`)**  
CSS rules are injected before the page's own scripts run. Class tokens like `.silentTube-hide-shorts` are applied to `<html>` and immediately hide matching elements — zero flash of unwanted content.

**Layer 2 — JavaScript (`content.js` + `MutationObserver`)**  
YouTube is a Single Page Application (SPA). After navigation or dynamic content loads, a `MutationObserver` fires to:
- Re-apply class tokens after each SPA route change.
- Toggle YouTube's native autoplay button via DOM click.
- Inject the Focus overlay on the home page.
- Check the channel whitelist on each page load.

The observer is throttled to one callback per animation frame (`requestAnimationFrame`) so it never causes jank.

### Settings Sync
- All user preferences are stored in `chrome.storage.sync` — they follow you across Chrome profiles.
- Statistics (focus time) are stored in `chrome.storage.local` — device-specific, not synced.
- Popup changes are broadcast in real-time to the active YouTube tab via `chrome.tabs.sendMessage`, so you don't need to refresh.

---

## 🛠 Development Notes

### Modifying CSS Selectors
YouTube periodically changes its HTML structure. If a blocker stops working, update the selectors in `content.css`. The CSS classes applied to `<html>` (e.g., `silentTube-hide-shorts`) remain stable — only the target selectors may need updating.

### Adding a New Blocker
1. Add a new setting key to `DEFAULTS` in both `popup.js` and `content.js`.
2. Add a `SETTING_CLASS_MAP` entry in `content.js`.
3. Add CSS rules under `.silentTube-hide-<suffix>` in `content.css`.
4. Add a toggle row in `popup.html` and wire it in `popup.js` `blockerMap`.

### Permissions Used
| Permission | Reason |
|---|---|
| `storage` | Save and sync user settings |
| `tabs` | Query active tab to broadcast live setting changes |
| `alarms` | Daily stats cleanup at midnight |
| `notifications` | Session timer completion alert |
| `host_permissions: youtube.com` | Inject content scripts |

---

## 🔒 Privacy

SilentTube collects **zero** personal data. All settings and statistics are stored locally in your browser. Nothing is transmitted to any server. The extension has no analytics, no telemetry, and no network requests beyond what Chrome itself makes.

---

## 📋 Roadmap

- [ ] Firefox / Edge WebExtension port
- [ ] Pomodoro-style break reminders
- [ ] Per-channel blocker configuration
- [ ] Dark/light popup theme toggle
- [ ] YouTube Music support

---

## 🤝 Contributing

Pull requests are welcome! Please:
1. Fork the repo and create a feature branch.
2. Keep code vanilla JS — no build tools required.
3. Test on the latest stable Chrome.
4. Open a PR with a clear description of what changed.

---

## 📄 License

MIT © 2024 — free to use, modify, and distribute.
