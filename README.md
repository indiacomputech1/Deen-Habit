# 🌙 DeenHabit — Islamic Habit Tracker PWA

A beautiful, offline-first PWA for tracking daily Islamic habits, with optional cloud sync across devices.

---

## Features

- **5 Daily Prayers** (Fard + Sunnah), **Quran**, **Adhkar**, **Dhikr Counter**, **Dua Checklist**, **Sadaqah**
- **Ramadan Mode** — Fasting, Sahur, Iftar, Taraweeh, Tahajjud
- **Live Prayer Times** — Suhoor/Iftar times for any city + live countdown
- **Weekly & Monthly visualizations**, **Streak tracker**
- **Cloud Sync** — sign in to sync across devices (Supabase)
- **Google OAuth + Email/Password + Magic Link**
- **Hardened Service Worker** — versioned caches, update toast
- **Installable PWA**, works fully offline, dark/light mode

---

## Quick Start

```bash
npm install
npm run dev
```

The app works fully **without** Supabase — local-only mode uses localStorage.

---

## Cloud Sync Setup (Supabase — optional)

### 1. Create a project at [supabase.com](https://supabase.com) (free tier)

### 2. Run the database schema

Supabase Dashboard → **SQL Editor** → paste & run [`supabase/schema.sql`](./supabase/schema.sql)

### 3. Enable Google OAuth (optional)

Supabase → Authentication → Providers → Google  
Add callback URL: `https://your-project-ref.supabase.co/auth/v1/callback`

### 4. Add env variables

```bash
cp .env.example .env.local
# Edit .env.local with your Supabase URL and anon key
```

---

## Deploy to Vercel

```bash
git add . && git commit -m "feat: auth + hardened SW"
git push
```

Connect your repo at **vercel.com** → New Project → Import.  
Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel → Settings → Environment Variables.

---

## Bumping the Service Worker Version

Edit `public/sw.js` line 3:

```js
const SW_VERSION = "2.1.0"; // increment to push an update
```

Deploy → users see a **"✨ Update available"** toast automatically.

---

## Project Structure

```
deenhabit/
├── src/
│   ├── App.tsx        ← Full app UI + logic
│   ├── supabase.ts    ← Auth + cloud sync layer
│   ├── types.ts       ← Shared TypeScript types
│   ├── main.tsx
│   └── index.css
├── public/
│   ├── sw.js          ← Versioned service worker
│   ├── manifest.json
│   └── icons/
├── supabase/
│   └── schema.sql     ← Run once in Supabase SQL editor
├── .env.example
└── vercel.json
```

---

## Sync Behaviour

| Scenario | Result |
|---|---|
| First sign-in | Local + cloud data merged, then pushed |
| Data conflict | Day with more completed prayers wins |
| Offline edits | Saved locally, synced on next open |
| New device | Remote data pulled and merged with local |

---

*May Allah make it a means of benefit. آمين*
