# 🌙 DeenHabit — Islamic Habit Tracker PWA

A beautiful, offline-first Progressive Web App for tracking daily Islamic habits.

## Features

- **Dual Mode**: Toggle between Annual Mode and Ramadan Mode
- **5 Daily Prayers** with Fard + Sunnah tracking
- **Quran Reading** with custom daily page goal
- **Morning & Evening Adhkar** checkboxes
- **Dhikr Counter** (SubhanAllah / Alhamdulillah / Allahu Akbar) with progress rings
- **Dua Checklist** for daily duas
- **Sadaqah** daily charity reminder
- **Ramadan Extras**: Fasting, Sahur, Iftar, Taraweeh, Tahajjud
- **Weekly & Monthly visualizations** (bar chart + heatmap calendar)
- **Dashboard** with streak tracking and prayer consistency stats
- **Dark / Light mode**
- **Hijri date display**
- **100% local** — all data saved in `localStorage`, no backend needed
- **Installable PWA** — works fully offline

---

## 🚀 Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Run in development

```bash
npm run dev
```

### 3. Build for production

```bash
npm run build
npm run preview
```

---

## 📱 Making it a PWA

### Required files (already included):
| File | Purpose |
|---|---|
| `public/manifest.json` | App metadata, icons, display mode |
| `public/sw.js` | Service worker for offline caching |
| `index.html` | SW registration + meta tags |

### Icons (you need to add):
Create `public/icons/` and add:
- `icon-192.png` — 192×192 px app icon
- `icon-512.png` — 512×512 px app icon

You can generate them at: https://www.pwabuilder.com/imageGenerator

### Optional: Use `vite-plugin-pwa` for full automation

```bash
npm install -D vite-plugin-pwa
```

Then uncomment the `VitePWA(...)` block in `vite.config.ts`.

---

## 🗂 Project Structure

```
deenhabit/
├── public/
│   ├── manifest.json      # PWA manifest
│   ├── sw.js              # Service worker
│   └── icons/             # App icons (add manually)
├── src/
│   ├── App.tsx            # Main application (single file)
│   └── main.tsx           # React entry point
├── index.html
├── vite.config.ts
├── package.json
└── tsconfig.json
```

---

## 🌙 Ramadan Mode

Toggle the **Ramadan** button in the header to switch modes. This adds:
- Fasting, Sahur, Iftar, Taraweeh, Tahajjud tracking
- These contribute to your daily progress score

---

## 💾 Data Storage

All data is stored in `localStorage` under the key `deenhabit_v1`.
Format: JSON with a `days` map keyed by `YYYY-MM-DD`.

To export/backup: open DevTools → Application → Local Storage → copy the `deenhabit_v1` value.

---

## 🎨 Customization

- **Colors**: Edit Tailwind classes in `App.tsx` (`emerald-500` is the primary)
- **Habits**: Add to `DUA_LIST`, `PRAYERS`, or the `DayData` type
- **Dhikr target**: Adjustable in-app
- **Quran goal**: Adjustable in-app (1–604 pages)

---

*May Allah make it a means of benefit. آمين*
