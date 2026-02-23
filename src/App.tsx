import { useState, useEffect, useCallback, useRef } from "react";
import {
  supabase,
  isSupabaseConfigured,
  signInWithGoogle,
  signInWithEmail,
  signUpWithEmail,
  signInMagicLink,
  signOut,
  pushToCloud,
  pullFromCloud,
  mergeAppData,
  pullProfile,
  type User,
} from "./supabase";
import ProfileTab, { DEFAULT_PROFILE, loadProfile, saveProfile } from "./ProfileTab";
import type { UserProfile } from "./types";

// ─── Types ────────────────────────────────────────────────────────────────────

type Mode = "annual" | "ramadan";
type Theme = "light" | "dark";
type Tab = "today" | "weekly" | "monthly" | "dhikr" | "dua" | "dashboard" | "profile";

interface Prayer {
  id: string;
  name: string;
  arabic: string;
  fard: boolean;
  sunnah: boolean;
}

interface LocationInfo {
  lat: number;
  lng: number;
  city: string;
  country: string;
}

interface PrayerTimes {
  Fajr: string;
  Sunrise: string;
  Dhuhr: string;
  Asr: string;
  Maghrib: string;
  Isha: string;
  date: string; // YYYY-MM-DD
  location: string;
}

const DEFAULT_LOCATION: LocationInfo = {
  lat: 19.076,
  lng: 72.8777,
  city: "Mumbai",
  country: "India",
};

// ─── Prayer Times Engine (Aladhan API) ────────────────────────────────────────

async function fetchPrayerTimes(
  lat: number,
  lng: number,
  dateStr: string
): Promise<PrayerTimes | null> {
  try {
    const [year, month, day] = dateStr.split("-");
    // Method 1 = University of Islamic Sciences, Karachi (standard for India/Pakistan)
    const url = `https://api.aladhan.com/v1/timings/${day}-${month}-${year}?latitude=${lat}&longitude=${lng}&method=1`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const t = json.data?.timings;
    if (!t) return null;
    return {
      Fajr: t.Fajr,
      Sunrise: t.Sunrise,
      Dhuhr: t.Dhuhr,
      Asr: t.Asr,
      Maghrib: t.Maghrib,
      Isha: t.Isha,
      date: dateStr,
      location: "",
    };
  } catch {
    return null;
  }
}

async function geocodeCity(query: string): Promise<LocationInfo | null> {
  try {
    // Use OpenStreetMap Nominatim for geocoding (no key needed)
    const nomUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
    const res = await fetch(nomUrl, {
      headers: { "Accept-Language": "en" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.length === 0) return null;
    const place = data[0];
    return {
      lat: parseFloat(place.lat),
      lng: parseFloat(place.lon),
      city: place.display_name.split(",")[0].trim(),
      country: place.display_name.split(",").pop()?.trim() || "",
    };
  } catch {
    return null;
  }
}

// Convert "HH:MM" string to total minutes since midnight
function timeToMins(t: string): number {
  const [h, m] = t.replace(/\s*(AM|PM)/i, "").split(":").map(Number);
  return h * 60 + m;
}

// Format "HH:MM" (24h) to "h:mm AM/PM"
function fmt12(t: string): string {
  const [hStr, mStr] = t.split(":");
  let h = parseInt(hStr);
  const m = mStr.padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

// Seconds until a time string (HH:MM) today
function secsUntil(t: string): number {
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const targetMins = timeToMins(t);
  let diff = (targetMins - nowMins) * 60 - now.getSeconds();
  if (diff < 0) diff += 24 * 3600;
  return diff;
}

function formatCountdown(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const PRAYER_TIMES_CACHE_KEY = "deenhabit_ptcache";

function cachePrayerTimes(pt: PrayerTimes, loc: LocationInfo) {
  try {
    localStorage.setItem(
      PRAYER_TIMES_CACHE_KEY,
      JSON.stringify({ pt, loc, cachedAt: new Date().toISOString() })
    );
  } catch {}
}

function getCachedPrayerTimes(): { pt: PrayerTimes; loc: LocationInfo } | null {
  try {
    const raw = localStorage.getItem(PRAYER_TIMES_CACHE_KEY);
    if (!raw) return null;
    const { pt, loc, cachedAt } = JSON.parse(raw);
    const today = toDateStr(new Date());
    // Only use cache if it's for today
    if (pt.date === today) return { pt, loc };
    return null;
  } catch {
    return null;
  }
}

interface HabitEntry {
  [key: string]: boolean | number;
}

interface DayData {
  date: string; // YYYY-MM-DD
  mode: Mode;
  prayers: { [prayerId: string]: { fard: boolean; sunnah: boolean } };
  quranPages: number;
  quranGoal: number;
  morningAdhkar: boolean;
  eveningAdhkar: boolean;
  subhanAllah: number;
  alhamdulillah: number;
  allahuAkbar: number;
  sadaqah: boolean;
  fasting: boolean;
  sahur: boolean;
  iftar: boolean;
  taraweeh: boolean;
  tahajjud: boolean;
  duaChecklist: { [id: string]: boolean };
}

interface AppData {
  days: { [date: string]: DayData };
  quranGoal: number;
  dhikrTarget: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PRAYERS: Prayer[] = [
  { id: "fajr", name: "Fajr", arabic: "الفجر", fard: false, sunnah: false },
  { id: "dhuhr", name: "Dhuhr", arabic: "الظهر", fard: false, sunnah: false },
  { id: "asr", name: "Asr", arabic: "العصر", fard: false, sunnah: false },
  { id: "maghrib", name: "Maghrib", arabic: "المغرب", fard: false, sunnah: false },
  { id: "isha", name: "Isha", arabic: "العشاء", fard: false, sunnah: false },
];

const DUA_LIST = [
  { id: "morning", label: "Morning Dua (Ayat al-Kursi)" },
  { id: "sleep", label: "Dua before sleep" },
  { id: "wakeup", label: "Dua upon waking" },
  { id: "eating", label: "Dua before eating" },
  { id: "travel", label: "Dua for travel" },
  { id: "istighfar", label: "Istighfar (x100)" },
  { id: "salawat", label: "Salawat on Prophet ﷺ" },
];

const STORAGE_KEY = "deenhabit_v1";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

function toHijri(date: Date): string {
  try {
    return new Intl.DateTimeFormat("en-u-ca-islamic", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date);
  } catch {
    return "";
  }
}

function getWeekDates(anchor: Date): string[] {
  const day = anchor.getDay();
  const monday = new Date(anchor);
  monday.setDate(anchor.getDate() - ((day + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return toDateStr(d);
  });
}

function getMonthDates(anchor: Date): string[] {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const days = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: days }, (_, i) =>
    toDateStr(new Date(year, month, i + 1))
  );
}

function calcDayScore(d: DayData, mode: Mode): number {
  let score = 0;
  let total = 0;
  for (const p of PRAYERS) {
    total += 2;
    if (d.prayers[p.id]?.fard) score++;
    if (d.prayers[p.id]?.sunnah) score++;
  }
  total += 3;
  if (d.morningAdhkar) score++;
  if (d.eveningAdhkar) score++;
  if (d.sadaqah) score++;
  total += 1;
  if (d.quranPages >= d.quranGoal && d.quranGoal > 0) score++;
  if (mode === "ramadan") {
    total += 3;
    if (d.fasting) score++;
    if (d.taraweeh) score++;
    if (d.tahajjud) score++;
  }
  return total > 0 ? Math.round((score / total) * 100) : 0;
}

function emptyDay(date: string, mode: Mode, quranGoal: number): DayData {
  const prayers: DayData["prayers"] = {};
  for (const p of PRAYERS) prayers[p.id] = { fard: false, sunnah: false };
  const duaChecklist: { [id: string]: boolean } = {};
  for (const d of DUA_LIST) duaChecklist[d.id] = false;
  return {
    date,
    mode,
    prayers,
    quranPages: 0,
    quranGoal,
    morningAdhkar: false,
    eveningAdhkar: false,
    subhanAllah: 0,
    alhamdulillah: 0,
    allahuAkbar: 0,
    sadaqah: false,
    fasting: false,
    sahur: false,
    iftar: false,
    taraweeh: false,
    tahajjud: false,
    duaChecklist,
  };
}

function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { days: {}, quranGoal: 1, dhikrTarget: 33 };
}

function saveData(data: AppData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProgressRing({
  pct,
  size = 64,
  stroke = 5,
  color,
}: {
  pct: number;
  size?: number;
  stroke?: number;
  color?: string;
}) {
  const r = (size - stroke * 2) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  return (
    <svg width={size} height={size} className="rotate-[-90deg]">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        className="opacity-10"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color || "currentColor"}
        strokeWidth={stroke}
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 0.6s ease" }}
      />
    </svg>
  );
}

function Check({
  checked,
  onChange,
  label,
  sub,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  sub?: string;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl transition-all duration-200 text-left ${
        checked
          ? "bg-emerald-500/20 border border-emerald-500/40"
          : "bg-white/5 border border-white/10 hover:border-white/20"
      }`}
    >
      <span
        className={`w-6 h-6 flex-shrink-0 rounded-full border-2 flex items-center justify-center transition-all ${
          checked
            ? "border-emerald-400 bg-emerald-400"
            : "border-white/30"
        }`}
      >
        {checked && (
          <svg viewBox="0 0 12 10" className="w-3 h-3 text-white fill-none stroke-white stroke-2">
            <polyline points="1,5 4,8 11,1" />
          </svg>
        )}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {sub && <span className="block text-xs opacity-50">{sub}</span>}
      </span>
    </button>
  );
}

function Counter({
  label,
  arabic,
  value,
  target,
  onChange,
}: {
  label: string;
  arabic: string;
  value: number;
  target: number;
  onChange: (v: number) => void;
}) {
  const pct = Math.min(100, (value / target) * 100);
  return (
    <div className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-white/5 border border-white/10">
      <div className="relative flex items-center justify-center">
        <ProgressRing pct={pct} size={72} stroke={4} color="#10b981" />
        <span className="absolute text-base font-bold">{value}</span>
      </div>
      <p className="text-xs font-medium opacity-70">{label}</p>
      <p className="text-sm font-semibold font-arabic">{arabic}</p>
      <div className="flex gap-2">
        <button
          onClick={() => onChange(Math.max(0, value - 1))}
          className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-lg font-bold transition-colors"
        >
          −
        </button>
        <button
          onClick={() => onChange(value + 1)}
          className="w-8 h-8 rounded-full bg-emerald-500 hover:bg-emerald-400 text-white text-lg font-bold transition-colors"
        >
          +
        </button>
      </div>
      <p className="text-xs opacity-40">/{target}</p>
    </div>
  );
}

function ScoreBar({ label, pct }: { label: string; pct: number }) {
  const color =
    pct >= 80 ? "#10b981" : pct >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs w-20 shrink-0 opacity-60">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="text-xs w-8 text-right font-mono opacity-80">
        {pct}%
      </span>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [mode, setMode] = useState<Mode>("annual");
  const [tab, setTab] = useState<Tab>("today");
  const [appData, setAppData] = useState<AppData>(loadData);
  const [editGoal, setEditGoal] = useState(false);
  const today = toDateStr(new Date());
  const hijri = toHijri(new Date());

  // ─── Profile State ────────────────────────────────────────────────────────
  const [profile, setProfile] = useState<UserProfile>(loadProfile);

  function handleProfileChange(p: UserProfile) {
    setProfile(p);
    saveProfile(p);
    // Sync goals back to appData so they stay in sync
    if (p.quranGoal !== appData.quranGoal || p.dhikrTarget !== appData.dhikrTarget) {
      setAppData((prev) => ({ ...prev, quranGoal: p.quranGoal, dhikrTarget: p.dhikrTarget }));
    }
  }

  // ─── Auth State ───────────────────────────────────────────────────────────
  const [user, setUser] = useState<User | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup" | "magic">("signin");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "synced" | "error">("idle");
  const [showUserMenu, setShowUserMenu] = useState(false);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── SW Update State ──────────────────────────────────────────────────────
  const [swUpdateReady, setSwUpdateReady] = useState(false);
  const [swVersion, setSwVersion] = useState<string | null>(null);
  const swRegistrationRef = useRef<ServiceWorkerRegistration | null>(null);

  // ─── Auth: listen for session changes ─────────────────────────────────────
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // ─── Auth: sync on login / pull remote data ───────────────────────────────
  useEffect(() => {
    if (!user) return;
    (async () => {
      setSyncStatus("syncing");
      // Pull habit data
      const remote = await pullFromCloud(user.id);
      if (remote) {
        const local = loadData();
        const merged = mergeAppData(local, remote);
        setAppData(merged);
        saveData(merged);
      }
      // Pull profile
      const remoteProfile = await pullProfile(user.id);
      if (remoteProfile) {
        setProfile({ ...DEFAULT_PROFILE, ...remoteProfile });
        saveProfile({ ...DEFAULT_PROFILE, ...remoteProfile });
      }
      // Push local data up
      const pushed = await pushToCloud(appData, user.id);
      setSyncStatus(pushed ? "synced" : "error");
    })();
  }, [user]);

  // ─── Auth: debounced auto-sync on data change ─────────────────────────────
  useEffect(() => {
    if (!user) return;
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    syncTimeoutRef.current = setTimeout(async () => {
      setSyncStatus("syncing");
      const ok = await pushToCloud(appData, user.id);
      setSyncStatus(ok ? "synced" : "error");
    }, 2000); // 2s debounce
    return () => {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    };
  }, [appData, user]);

  // ─── SW: register and listen for updates ─────────────────────────────────
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").then((reg) => {
      swRegistrationRef.current = reg;

      // New SW waiting → show update toast
      if (reg.waiting) setSwUpdateReady(true);

      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            setSwUpdateReady(true);
          }
        });
      });
    });

    // Listen for SW_ACTIVATED broadcast
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "SW_ACTIVATED") {
        setSwVersion(event.data.version);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);

  const applySwUpdate = () => {
    const reg = swRegistrationRef.current;
    if (reg?.waiting) {
      reg.waiting.postMessage({ type: "SKIP_WAITING" });
    }
    setSwUpdateReady(false);
    window.location.reload();
  };

  // ─── Auth handlers ────────────────────────────────────────────────────────
  const handleAuthSubmit = async () => {
    setAuthLoading(true);
    setAuthError(null);
    setAuthSuccess(null);
    try {
      if (authMode === "magic") {
        const { error } = await signInMagicLink(authEmail);
        if (error) throw error;
        setAuthSuccess("Magic link sent! Check your email.");
      } else if (authMode === "signup") {
        const { error } = await signUpWithEmail(authEmail, authPassword);
        if (error) throw error;
        setAuthSuccess("Account created! Check your email to confirm.");
      } else {
        const { error } = await signInWithEmail(authEmail, authPassword);
        if (error) throw error;
        setShowAuthModal(false);
      }
    } catch (err: any) {
      setAuthError(err.message || "Something went wrong.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const { error } = await signInWithGoogle();
      if (error) throw error;
    } catch (err: any) {
      setAuthError(err.message || "Google sign-in failed.");
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    setShowUserMenu(false);
    setSyncStatus("idle");
  };

  // ─── Prayer Times State ────────────────────────────────────────────────────
  const [prayerTimes, setPrayerTimes] = useState<PrayerTimes | null>(null);
  const [location, setLocation] = useState<LocationInfo>(DEFAULT_LOCATION);
  const [ptLoading, setPtLoading] = useState(false);
  const [ptError, setPtError] = useState<string | null>(null);
  const [showLocationSearch, setShowLocationSearch] = useState(false);
  const [locationQuery, setLocationQuery] = useState("");
  const [locationSearching, setLocationSearching] = useState(false);
  const [countdown, setCountdown] = useState<{ label: string; secs: number } | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load cached prayer times on mount, then fetch fresh
  useEffect(() => {
    const cached = getCachedPrayerTimes();
    if (cached) {
      setPrayerTimes(cached.pt);
      setLocation(cached.loc);
    }
  }, []);

  // Fetch prayer times whenever location or date changes (only in ramadan mode)
  const loadPrayerTimes = useCallback(async (loc: LocationInfo) => {
    setPtLoading(true);
    setPtError(null);
    const pt = await fetchPrayerTimes(loc.lat, loc.lng, today);
    setPtLoading(false);
    if (pt) {
      pt.location = `${loc.city}, ${loc.country}`;
      setPrayerTimes(pt);
      cachePrayerTimes(pt, loc);
    } else {
      setPtError("Could not load prayer times. Check your connection.");
    }
  }, [today]);

  useEffect(() => {
    if (mode === "ramadan") {
      // Only fetch if no valid cache
      const cached = getCachedPrayerTimes();
      if (!cached) {
        loadPrayerTimes(location);
      }
    }
  }, [mode, location, loadPrayerTimes]);

  // Countdown timer — ticks every second
  useEffect(() => {
    if (!prayerTimes || mode !== "ramadan") {
      if (countdownRef.current) clearInterval(countdownRef.current);
      setCountdown(null);
      return;
    }

    const tick = () => {
      const now = new Date();
      const nowMins = now.getHours() * 60 + now.getMinutes();
      const fajrMins = timeToMins(prayerTimes.Fajr);
      const maghribMins = timeToMins(prayerTimes.Maghrib);

      // Suhoor ends at Fajr, Iftar starts at Maghrib
      let label = "";
      let targetMins = 0;

      if (nowMins < fajrMins) {
        label = "Suhoor ends";
        targetMins = fajrMins;
      } else if (nowMins < maghribMins) {
        label = "Iftar in";
        targetMins = maghribMins;
      } else {
        label = "Fajr in";
        targetMins = fajrMins + 24 * 60; // tomorrow fajr
      }

      const diffMins = targetMins - nowMins;
      const secs = diffMins * 60 - now.getSeconds();
      setCountdown({ label, secs: Math.max(0, secs) });
    };

    tick();
    countdownRef.current = setInterval(tick, 1000);
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [prayerTimes, mode]);

  // Geolocation handler
  const detectLocation = () => {
    if (!navigator.geolocation) {
      setPtError("Geolocation not supported by your browser.");
      return;
    }
    setPtLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        // Reverse geocode via Nominatim
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&format=json`,
            { headers: { "Accept-Language": "en" } }
          );
          const data = await res.json();
          const city =
            data.address?.city ||
            data.address?.town ||
            data.address?.village ||
            data.address?.county ||
            "Your Location";
          const country = data.address?.country || "";
          const newLoc: LocationInfo = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            city,
            country,
          };
          setLocation(newLoc);
          loadPrayerTimes(newLoc);
        } catch {
          const newLoc: LocationInfo = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            city: "Your Location",
            country: "",
          };
          setLocation(newLoc);
          loadPrayerTimes(newLoc);
        }
      },
      () => {
        setPtLoading(false);
        setPtError("Location access denied. Using Mumbai as default.");
      }
    );
  };

  // City search handler
  const handleCitySearch = async () => {
    if (!locationQuery.trim()) return;
    setLocationSearching(true);
    const result = await geocodeCity(locationQuery.trim());
    setLocationSearching(false);
    if (result) {
      setLocation(result);
      setShowLocationSearch(false);
      setLocationQuery("");
      loadPrayerTimes(result);
    } else {
      setPtError(`Could not find "${locationQuery}". Try a different city name.`);
    }
  };

  // Persist on change
  useEffect(() => {
    saveData(appData);
  }, [appData]);

  // Get or create today's data
  const dayData: DayData =
    appData.days[today] ||
    emptyDay(today, mode, appData.quranGoal);

  function updateDay(patch: Partial<DayData>) {
    setAppData((prev) => ({
      ...prev,
      days: {
        ...prev.days,
        [today]: { ...dayData, ...patch },
      },
    }));
  }

  function togglePrayer(id: string, field: "fard" | "sunnah") {
    const p = dayData.prayers[id] || { fard: false, sunnah: false };
    updateDay({
      prayers: { ...dayData.prayers, [id]: { ...p, [field]: !p[field] } },
    });
  }

  const isDark = theme === "dark";

  // ─── Tabs ───────────────────────────────────────────────────────────────────

  const weekDates = getWeekDates(new Date());
  const monthDates = getMonthDates(new Date());
  const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  function weekScores() {
    return weekDates.map((d) => {
      const day = appData.days[d];
      return day ? calcDayScore(day, mode) : 0;
    });
  }

  function monthScores() {
    return monthDates.map((d) => {
      const day = appData.days[d];
      return day ? calcDayScore(day, mode) : 0;
    });
  }

  const todayScore = calcDayScore(dayData, mode);
  const weekAvg = Math.round(
    weekScores().reduce((a, b) => a + b, 0) / 7
  );

  // ─── Today Tab ──────────────────────────────────────────────────────────────

  const TodayTab = () => (
    <div className="space-y-6">
      {/* Score summary */}
      <div className="flex items-center justify-between p-5 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 border border-emerald-500/20">
        <div>
          <p className="text-xs opacity-60 mb-1">Today's Progress</p>
          <p className="text-4xl font-bold">{todayScore}%</p>
          <p className="text-xs opacity-50 mt-1">{hijri}</p>
        </div>
        <div className="relative">
          <ProgressRing pct={todayScore} size={88} stroke={6} color="#10b981" />
          <span className="absolute inset-0 flex items-center justify-center text-lg">
            {todayScore >= 80 ? "✨" : todayScore >= 50 ? "🌙" : "🌑"}
          </span>
        </div>
      </div>

      {/* Ramadan Mode Toggle Card */}
      <div
        className={`rounded-2xl border transition-all duration-300 overflow-hidden ${
          mode === "ramadan"
            ? "border-amber-500/40 bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-transparent"
            : isDark
            ? "border-white/10 bg-white/5"
            : "border-black/10 bg-black/5"
        }`}
      >
        {/* Toggle header row */}
        <button
          onClick={() => setMode((m) => (m === "annual" ? "ramadan" : "annual"))}
          className="w-full flex items-center justify-between px-4 py-4"
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl">{mode === "ramadan" ? "🌙" : "☀️"}</span>
            <div className="text-left">
              <p className="text-sm font-bold">
                {mode === "ramadan" ? "Ramadan Mode" : "Ramadan Mode"}
              </p>
              <p className="text-xs opacity-50">
                {mode === "ramadan"
                  ? "Tracking fasting, Taraweeh & Tahajjud"
                  : "Tap to enable Ramadan tracking"}
              </p>
            </div>
          </div>
          {/* Pill toggle switch */}
          <div
            className={`relative w-12 h-6 rounded-full transition-all duration-300 flex-shrink-0 ${
              mode === "ramadan" ? "bg-amber-500" : isDark ? "bg-white/20" : "bg-black/20"
            }`}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-300 ${
                mode === "ramadan" ? "left-6" : "left-0.5"
              }`}
            />
          </div>
        </button>

        {/* Ramadan habit rows — animated reveal */}
        {mode === "ramadan" && (
          <div className="px-4 pb-4 space-y-3 border-t border-amber-500/20">

            {/* ── Prayer Times Card ── */}
            <div className="mt-3 rounded-xl overflow-hidden border border-amber-500/20 bg-black/20">

              {/* Location bar */}
              <div className="flex items-center justify-between px-3 py-2 bg-amber-500/10 border-b border-amber-500/15">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-sm">📍</span>
                  <span className="text-xs font-semibold text-amber-300 truncate">
                    {location.city}{location.country ? `, ${location.country}` : ""}
                  </span>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                  <button
                    onClick={detectLocation}
                    title="Use my location"
                    className="px-2 py-1 rounded-lg text-[10px] font-semibold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 transition-colors"
                  >
                    📡 Auto
                  </button>
                  <button
                    onClick={() => setShowLocationSearch((v) => !v)}
                    title="Search city"
                    className="px-2 py-1 rounded-lg text-[10px] font-semibold bg-white/10 hover:bg-white/20 transition-colors"
                  >
                    🔍
                  </button>
                </div>
              </div>

              {/* City search input */}
              {showLocationSearch && (
                <div className="flex gap-2 px-3 py-2 border-b border-white/10 bg-white/5">
                  <input
                    type="text"
                    placeholder="Search city (e.g. Delhi, London)"
                    value={locationQuery}
                    onChange={(e) => setLocationQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleCitySearch()}
                    className="flex-1 px-3 py-1.5 rounded-lg bg-white/10 border border-white/20 text-xs placeholder-white/30 outline-none focus:border-amber-400/50"
                  />
                  <button
                    onClick={handleCitySearch}
                    disabled={locationSearching}
                    className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-xs font-semibold disabled:opacity-50 transition-colors"
                  >
                    {locationSearching ? "..." : "Go"}
                  </button>
                </div>
              )}

              {/* Loading / Error */}
              {ptLoading && (
                <div className="flex items-center justify-center gap-2 py-4 text-xs opacity-60">
                  <span className="animate-spin text-base">⏳</span>
                  Loading prayer times…
                </div>
              )}
              {ptError && !ptLoading && (
                <div className="flex items-center gap-2 px-3 py-2 text-xs text-red-400 bg-red-500/10 border-b border-red-500/20">
                  <span>⚠️</span> {ptError}
                  <button
                    onClick={() => { setPtError(null); loadPrayerTimes(location); }}
                    className="ml-auto underline hover:no-underline"
                  >Retry</button>
                </div>
              )}

              {/* Main times display */}
              {prayerTimes && !ptLoading && (
                <>
                  {/* Suhoor & Iftar hero */}
                  <div className="grid grid-cols-2 divide-x divide-amber-500/20">
                    {/* Suhoor */}
                    <div className="flex flex-col items-center py-4 px-3 gap-1">
                      <span className="text-2xl">🌙</span>
                      <p className="text-[10px] font-semibold uppercase tracking-widest opacity-50">Suhoor Ends</p>
                      <p className="text-xl font-bold text-amber-300">{fmt12(prayerTimes.Fajr)}</p>
                      <p className="text-[10px] opacity-40">At Fajr Adhan</p>
                    </div>
                    {/* Iftar */}
                    <div className="flex flex-col items-center py-4 px-3 gap-1">
                      <span className="text-2xl">🌅</span>
                      <p className="text-[10px] font-semibold uppercase tracking-widest opacity-50">Iftar Time</p>
                      <p className="text-xl font-bold text-orange-300">{fmt12(prayerTimes.Maghrib)}</p>
                      <p className="text-[10px] opacity-40">At Maghrib Adhan</p>
                    </div>
                  </div>

                  {/* Countdown strip */}
                  {countdown && (
                    <div className="flex items-center justify-center gap-2 py-2 border-t border-amber-500/20 bg-amber-500/5">
                      <span className="text-xs opacity-60">{countdown.label}</span>
                      <span className="font-mono text-sm font-bold text-amber-300 tabular-nums">
                        {formatCountdown(countdown.secs)}
                      </span>
                    </div>
                  )}

                  {/* Full prayer schedule */}
                  <div className="border-t border-white/10">
                    <p className="text-[10px] font-semibold uppercase tracking-wider opacity-40 px-3 pt-2 pb-1">
                      Full Schedule
                    </p>
                    <div className="grid grid-cols-3 gap-px bg-white/5 border-t border-white/5">
                      {[
                        { name: "Fajr", arabic: "الفجر", time: prayerTimes.Fajr, icon: "🌄" },
                        { name: "Sunrise", arabic: "الشروق", time: prayerTimes.Sunrise, icon: "☀️" },
                        { name: "Dhuhr", arabic: "الظهر", time: prayerTimes.Dhuhr, icon: "🌞" },
                        { name: "Asr", arabic: "العصر", time: prayerTimes.Asr, icon: "🌤" },
                        { name: "Maghrib", arabic: "المغرب", time: prayerTimes.Maghrib, icon: "🌇" },
                        { name: "Isha", arabic: "العشاء", time: prayerTimes.Isha, icon: "🌙" },
                      ].map(({ name, arabic, time, icon }) => {
                        const isNext = (() => {
                          const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
                          const t = timeToMins(time);
                          return t > nowMins && [prayerTimes.Fajr, prayerTimes.Dhuhr, prayerTimes.Asr, prayerTimes.Maghrib, prayerTimes.Isha].some(
                            (pt) => pt === time && timeToMins(pt) === Math.min(
                              ...[prayerTimes.Fajr, prayerTimes.Dhuhr, prayerTimes.Asr, prayerTimes.Maghrib, prayerTimes.Isha]
                                .map(timeToMins)
                                .filter((m) => m > nowMins)
                            )
                          );
                        })();
                        return (
                          <div
                            key={name}
                            className={`flex flex-col items-center py-2.5 px-1 gap-0.5 transition-colors ${
                              isNext ? "bg-amber-500/15" : "bg-transparent"
                            }`}
                          >
                            <span className="text-sm">{icon}</span>
                            <p className={`text-[10px] font-semibold ${isNext ? "text-amber-300" : "opacity-60"}`}>{name}</p>
                            <p className={`text-xs font-bold tabular-nums ${isNext ? "text-amber-200" : ""}`}>{fmt12(time)}</p>
                            <p className="text-[9px] opacity-30">{arabic}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}

              {/* Empty state — no cache and not loading */}
              {!prayerTimes && !ptLoading && !ptError && (
                <div className="flex flex-col items-center gap-2 py-6 text-center">
                  <span className="text-3xl">🕌</span>
                  <p className="text-xs opacity-60">Prayer times will load automatically</p>
                  <button
                    onClick={() => loadPrayerTimes(location)}
                    className="px-4 py-1.5 rounded-full bg-amber-500/20 text-amber-300 text-xs font-semibold hover:bg-amber-500/30 transition-colors"
                  >
                    Load Now
                  </button>
                </div>
              )}
            </div>

            {/* ── Ramadan Habit Checks ── */}
            <p className="text-xs font-semibold uppercase tracking-wider opacity-50 pt-1 flex items-center gap-1">
              <span>🌙</span> Ramadan Habits
            </p>

            {/* Fasting + Sahur + Iftar row */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { key: "fasting" as const, label: "Fasting", arabic: "الصيام", icon: "🌅" },
                { key: "sahur" as const, label: "Sahur", arabic: "السحور", icon: "🍽️" },
                { key: "iftar" as const, label: "Iftar", arabic: "الإفطار", icon: "🌇" },
              ].map(({ key, label, arabic, icon }) => (
                <button
                  key={key}
                  onClick={() => updateDay({ [key]: !dayData[key] })}
                  className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border transition-all duration-200 ${
                    dayData[key]
                      ? "bg-amber-500/20 border-amber-500/50"
                      : isDark
                      ? "bg-white/5 border-white/10 hover:border-white/20"
                      : "bg-black/5 border-black/10 hover:border-black/20"
                  }`}
                >
                  <span className="text-xl">{icon}</span>
                  <span
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                      dayData[key] ? "border-amber-400 bg-amber-400" : "border-white/30"
                    }`}
                  >
                    {dayData[key] && (
                      <svg viewBox="0 0 12 10" className="w-2.5 h-2.5 fill-none stroke-white stroke-2">
                        <polyline points="1,5 4,8 11,1" />
                      </svg>
                    )}
                  </span>
                  <span className="text-xs font-semibold">{label}</span>
                  <span className="text-[10px] opacity-50">{arabic}</span>
                </button>
              ))}
            </div>

            {/* Taraweeh — full-width prominent card */}
            <button
              onClick={() => updateDay({ taraweeh: !dayData.taraweeh })}
              className={`w-full flex items-center gap-4 px-4 py-4 rounded-xl border transition-all duration-200 ${
                dayData.taraweeh
                  ? "bg-indigo-500/20 border-indigo-500/50"
                  : isDark
                  ? "bg-white/5 border-white/10 hover:border-white/20"
                  : "bg-black/5 border-black/10 hover:border-black/20"
              }`}
            >
              <span className="text-2xl">🕌</span>
              <div className="flex-1 text-left">
                <p className="text-sm font-bold">Taraweeh Prayer</p>
                <p className="text-xs opacity-50">صلاة التراويح · Night prayer in Ramadan</p>
                {prayerTimes && (
                  <p className="text-xs text-indigo-300 mt-0.5">After Isha · {fmt12(prayerTimes.Isha)}</p>
                )}
              </div>
              <span
                className={`w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all flex-shrink-0 ${
                  dayData.taraweeh
                    ? "border-indigo-400 bg-indigo-400"
                    : "border-white/30"
                }`}
              >
                {dayData.taraweeh && (
                  <svg viewBox="0 0 12 10" className="w-3 h-3 fill-none stroke-white stroke-2">
                    <polyline points="1,5 4,8 11,1" />
                  </svg>
                )}
              </span>
            </button>

            {/* Tahajjud — full-width prominent card */}
            <button
              onClick={() => updateDay({ tahajjud: !dayData.tahajjud })}
              className={`w-full flex items-center gap-4 px-4 py-4 rounded-xl border transition-all duration-200 ${
                dayData.tahajjud
                  ? "bg-purple-500/20 border-purple-500/50"
                  : isDark
                  ? "bg-white/5 border-white/10 hover:border-white/20"
                  : "bg-black/5 border-black/10 hover:border-black/20"
              }`}
            >
              <span className="text-2xl">⭐</span>
              <div className="flex-1 text-left">
                <p className="text-sm font-bold">Tahajjud Prayer</p>
                <p className="text-xs opacity-50">صلاة التهجد · Pre-dawn voluntary prayer</p>
                {prayerTimes && (
                  <p className="text-xs text-purple-300 mt-0.5">Before Suhoor ends · {fmt12(prayerTimes.Fajr)}</p>
                )}
              </div>
              <span
                className={`w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all flex-shrink-0 ${
                  dayData.tahajjud
                    ? "border-purple-400 bg-purple-400"
                    : "border-white/30"
                }`}
              >
                {dayData.tahajjud && (
                  <svg viewBox="0 0 12 10" className="w-3 h-3 fill-none stroke-white stroke-2">
                    <polyline points="1,5 4,8 11,1" />
                  </svg>
                )}
              </span>
            </button>

            {/* Ramadan mini summary */}
            <div className="flex gap-2 pt-1">
              {[
                { done: dayData.fasting, label: "Fasting" },
                { done: dayData.sahur, label: "Sahur" },
                { done: dayData.iftar, label: "Iftar" },
                { done: dayData.taraweeh, label: "Taraweeh" },
                { done: dayData.tahajjud, label: "Tahajjud" },
              ].map(({ done, label }) => (
                <div
                  key={label}
                  className={`flex-1 h-1 rounded-full transition-all duration-300 ${
                    done ? "bg-amber-400" : "bg-white/15"
                  }`}
                  title={label}
                />
              ))}
            </div>
            <p className="text-center text-xs opacity-40">
              {[dayData.fasting, dayData.sahur, dayData.iftar, dayData.taraweeh, dayData.tahajjud].filter(Boolean).length}/5 Ramadan habits
            </p>
          </div>
        )}
      </div>

      {/* Prayers */}
      <Section title="Salah" icon="🕌">
        {PRAYERS.map((p) => (
          <div key={p.id} className="flex items-center gap-2">
            <span className="w-20 text-sm font-semibold">
              {p.name}{" "}
              <span className="opacity-50 text-xs font-normal">{p.arabic}</span>
            </span>
            <div className="flex gap-2 flex-1">
              <button
                onClick={() => togglePrayer(p.id, "fard")}
                className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all ${
                  dayData.prayers[p.id]?.fard
                    ? "bg-emerald-500 text-white"
                    : "bg-white/5 hover:bg-white/10"
                }`}
              >
                Fard
              </button>
              <button
                onClick={() => togglePrayer(p.id, "sunnah")}
                className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all ${
                  dayData.prayers[p.id]?.sunnah
                    ? "bg-teal-500 text-white"
                    : "bg-white/5 hover:bg-white/10"
                }`}
              >
                Sunnah
              </button>
            </div>
          </div>
        ))}
      </Section>

      {/* Quran */}
      <Section title="Quran" icon="📖">
        <div className="flex items-center gap-4 p-4 rounded-xl bg-white/5 border border-white/10">
          <div className="flex-1">
            <p className="text-sm font-medium mb-1">Pages read today</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  updateDay({ quranPages: Math.max(0, dayData.quranPages - 1) })
                }
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 font-bold text-lg"
              >
                −
              </button>
              <span className="text-2xl font-bold w-8 text-center">
                {dayData.quranPages}
              </span>
              <button
                onClick={() =>
                  updateDay({ quranPages: dayData.quranPages + 1 })
                }
                className="w-8 h-8 rounded-full bg-emerald-500 hover:bg-emerald-400 text-white font-bold text-lg"
              >
                +
              </button>
            </div>
          </div>
          <div className="text-center">
            <ProgressRing
              pct={
                dayData.quranGoal > 0
                  ? Math.min(100, (dayData.quranPages / dayData.quranGoal) * 100)
                  : 0
              }
              size={56}
              stroke={4}
              color="#6366f1"
            />
            <p className="text-xs opacity-50 mt-1">
              Goal: {dayData.quranGoal} pg
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <span className="text-xs opacity-60">Daily goal:</span>
          <input
            type="number"
            min={1}
            max={604}
            value={appData.quranGoal}
            onChange={(e) => {
              const g = Math.max(1, Number(e.target.value));
              setAppData((prev) => ({ ...prev, quranGoal: g }));
              updateDay({ quranGoal: g });
            }}
            className="w-16 px-2 py-1 rounded-lg bg-white/10 border border-white/20 text-sm text-center"
          />
          <span className="text-xs opacity-60">pages</span>
        </div>
      </Section>

      {/* Adhkar */}
      <Section title="Adhkar" icon="📿">
        <div className="grid grid-cols-2 gap-2">
          <Check
            checked={dayData.morningAdhkar}
            onChange={(v) => updateDay({ morningAdhkar: v })}
            label="Morning Adhkar"
            sub="أذكار الصباح"
          />
          <Check
            checked={dayData.eveningAdhkar}
            onChange={(v) => updateDay({ eveningAdhkar: v })}
            label="Evening Adhkar"
            sub="أذكار المساء"
          />
        </div>
      </Section>

      {/* Sadaqah */}
      <Section title="Charity" icon="💚">
        <Check
          checked={dayData.sadaqah}
          onChange={(v) => updateDay({ sadaqah: v })}
          label="Gave Sadaqah today"
          sub="صدقة"
        />
      </Section>
    </div>
  );

  // ─── Dhikr Tab ──────────────────────────────────────────────────────────────

  const DhikrTab = () => (
    <div className="space-y-6">
      <div className="text-center py-4">
        <h2 className="text-lg font-semibold opacity-80">Dhikr Counter</h2>
        <p className="text-xs opacity-50">Target: {appData.dhikrTarget} each</p>
      </div>
      <div className="grid grid-cols-1 gap-4">
        <Counter
          label="SubhanAllah"
          arabic="سبحان الله"
          value={dayData.subhanAllah}
          target={appData.dhikrTarget}
          onChange={(v) => updateDay({ subhanAllah: v })}
        />
        <Counter
          label="Alhamdulillah"
          arabic="الحمد لله"
          value={dayData.alhamdulillah}
          target={appData.dhikrTarget}
          onChange={(v) => updateDay({ alhamdulillah: v })}
        />
        <Counter
          label="Allahu Akbar"
          arabic="الله أكبر"
          value={dayData.allahuAkbar}
          target={appData.dhikrTarget}
          onChange={(v) => updateDay({ allahuAkbar: v })}
        />
      </div>
      <div className="p-4 rounded-xl bg-white/5 border border-white/10 flex items-center gap-3">
        <span className="text-sm opacity-70">Daily target per dhikr:</span>
        <input
          type="number"
          min={1}
          value={appData.dhikrTarget}
          onChange={(e) =>
            setAppData((prev) => ({
              ...prev,
              dhikrTarget: Math.max(1, Number(e.target.value)),
            }))
          }
          className="w-16 px-2 py-1 rounded-lg bg-white/10 border border-white/20 text-sm text-center"
        />
      </div>
    </div>
  );

  // ─── Dua Tab ────────────────────────────────────────────────────────────────

  const DuaTab = () => (
    <div className="space-y-4">
      <div className="text-center py-2">
        <h2 className="text-lg font-semibold opacity-80">Daily Duas</h2>
      </div>
      {DUA_LIST.map((d) => (
        <Check
          key={d.id}
          checked={dayData.duaChecklist[d.id] || false}
          onChange={(v) =>
            updateDay({
              duaChecklist: { ...dayData.duaChecklist, [d.id]: v },
            })
          }
          label={d.label}
        />
      ))}
      <div className="mt-4 p-4 rounded-xl bg-white/5 border border-white/10 text-center">
        <p className="text-2xl font-bold">
          {Object.values(dayData.duaChecklist).filter(Boolean).length}/
          {DUA_LIST.length}
        </p>
        <p className="text-xs opacity-50 mt-1">Duas completed</p>
      </div>
    </div>
  );

  // ─── Weekly Tab ─────────────────────────────────────────────────────────────

  const WeeklyTab = () => {
    const scores = weekScores();
    return (
      <div className="space-y-6">
        <div className="text-center py-2">
          <h2 className="text-lg font-semibold opacity-80">This Week</h2>
          <p className="text-xs opacity-50">Weekly avg: {weekAvg}%</p>
        </div>
        {/* Bar chart */}
        <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
          <div className="flex items-end justify-between gap-2 h-32">
            {scores.map((s, i) => {
              const isToday = weekDates[i] === today;
              const color = s >= 80 ? "#10b981" : s >= 50 ? "#f59e0b" : s > 0 ? "#ef4444" : "#ffffff20";
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className="w-full rounded-t-lg transition-all duration-500"
                    style={{
                      height: `${Math.max(4, s)}%`,
                      background: color,
                      opacity: isToday ? 1 : 0.7,
                      boxShadow: isToday ? `0 0 12px ${color}` : "none",
                    }}
                  />
                  <span className={`text-xs ${isToday ? "font-bold" : "opacity-50"}`}>
                    {DAY_LABELS[i]}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between mt-3 text-xs opacity-40">
            <span>0%</span>
            <span>50%</span>
            <span>100%</span>
          </div>
        </div>
        {/* Score bars */}
        <div className="space-y-3 p-4 rounded-2xl bg-white/5 border border-white/10">
          {weekDates.map((d, i) => (
            <ScoreBar key={d} label={DAY_LABELS[i]} pct={scores[i]} />
          ))}
        </div>
      </div>
    );
  };

  // ─── Monthly Tab ────────────────────────────────────────────────────────────

  const MonthlyTab = () => {
    const scores = monthScores();
    const avg = Math.round(
      scores.filter((s) => s > 0).reduce((a, b) => a + b, 0) /
        (scores.filter((s) => s > 0).length || 1)
    );
    return (
      <div className="space-y-6">
        <div className="text-center py-2">
          <h2 className="text-lg font-semibold opacity-80">This Month</h2>
          <p className="text-xs opacity-50">Active days avg: {avg}%</p>
        </div>
        <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
          <div className="grid grid-cols-7 gap-1">
            {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
              <div key={i} className="text-center text-xs opacity-40 py-1">
                {d}
              </div>
            ))}
            {/* Offset for first day */}
            {Array.from({
              length: (new Date(new Date().getFullYear(), new Date().getMonth(), 1).getDay() + 6) % 7,
            }).map((_, i) => (
              <div key={"off" + i} />
            ))}
            {scores.map((s, i) => {
              const d = monthDates[i];
              const isToday = d === today;
              const color = s >= 80 ? "bg-emerald-500" : s >= 50 ? "bg-amber-500" : s > 0 ? "bg-red-500" : "bg-white/10";
              return (
                <div
                  key={d}
                  className={`aspect-square rounded-md ${color} flex items-center justify-center text-xs font-bold transition-all ${
                    isToday ? "ring-2 ring-white/60" : ""
                  }`}
                  title={`${d}: ${s}%`}
                >
                  {i + 1}
                </div>
              );
            })}
          </div>
        </div>
        <div className="flex gap-3 text-xs justify-center">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-emerald-500 inline-block" /> ≥80%
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-amber-500 inline-block" /> ≥50%
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-red-500 inline-block" /> &lt;50%
          </span>
        </div>
      </div>
    );
  };

  // ─── Dashboard Tab ───────────────────────────────────────────────────────────

  const DashboardTab = () => {
    const allDays = Object.values(appData.days);
    const tracked = allDays.length;
    const overallAvg =
      tracked > 0
        ? Math.round(allDays.reduce((a, d) => a + calcDayScore(d, mode), 0) / tracked)
        : 0;
    const streak = (() => {
      let s = 0;
      const d = new Date();
      while (true) {
        const key = toDateStr(d);
        if (appData.days[key] && calcDayScore(appData.days[key], mode) > 0) {
          s++;
          d.setDate(d.getDate() - 1);
        } else break;
      }
      return s;
    })();
    const prayerStats = PRAYERS.map((p) => ({
      name: p.name,
      fard: Math.round(
        (allDays.filter((d) => d.prayers[p.id]?.fard).length / (tracked || 1)) * 100
      ),
    }));
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Days Tracked", value: tracked, icon: "📅" },
            { label: "Overall Avg", value: `${overallAvg}%`, icon: "📊" },
            { label: "Current Streak", value: `${streak}d`, icon: "🔥" },
          ].map((s) => (
            <div
              key={s.label}
              className="p-3 rounded-2xl bg-white/5 border border-white/10 text-center"
            >
              <p className="text-2xl mb-1">{s.icon}</p>
              <p className="text-xl font-bold">{s.value}</p>
              <p className="text-xs opacity-50 leading-tight">{s.label}</p>
            </div>
          ))}
        </div>
        <Section title="Prayer Consistency" icon="🕌">
          {prayerStats.map((p) => (
            <ScoreBar key={p.name} label={p.name} pct={p.fard} />
          ))}
        </Section>
        <Section title="Quran Progress" icon="📖">
          <div className="text-center p-4">
            <p className="text-3xl font-bold">
              {allDays.reduce((a, d) => a + d.quranPages, 0)}
            </p>
            <p className="text-xs opacity-50">Total pages read</p>
          </div>
        </Section>
      </div>
    );
  };

  // ─── Section wrapper ─────────────────────────────────────────────────────────

  function Section({
    title,
    icon,
    children,
  }: {
    title: string;
    icon: string;
    children: React.ReactNode;
  }) {
    return (
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider opacity-50 flex items-center gap-2">
          <span>{icon}</span> {title}
        </h3>
        <div className="space-y-2">{children}</div>
      </div>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: "today", label: "Today", icon: "☀️" },
    { id: "weekly", label: "Week", icon: "📅" },
    { id: "monthly", label: "Month", icon: "🗓️" },
    { id: "dhikr", label: "Dhikr", icon: "📿" },
    { id: "dua", label: "Dua", icon: "🤲" },
    { id: "dashboard", label: "Stats", icon: "📊" },
    { id: "profile", label: "Profile", icon: profile.avatar || "👤" },
  ];

  return (
    <div
      className={`min-h-screen font-sans transition-colors duration-300 ${
        isDark
          ? "bg-[#0a0f0d] text-white"
          : "bg-[#f0f7f4] text-[#0a1a13]"
      }`}
      style={{ fontFamily: "'Segoe UI', system-ui, sans-serif" }}
    >
      {/* Header */}
      <header
        className={`sticky top-0 z-10 backdrop-blur-xl border-b ${
          isDark
            ? "bg-[#0a0f0d]/80 border-white/10"
            : "bg-[#f0f7f4]/80 border-black/10"
        }`}
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              <span className="text-emerald-400">Deen</span>Habit
            </h1>
            <p className="text-xs opacity-40">{hijri}</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Ramadan badge */}
            {mode === "ramadan" && (
              <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                🌙 Ramadan
              </span>
            )}

            {/* Sync status indicator */}
            {user && (
              <span title={`Sync: ${syncStatus}`} className="text-sm">
                {syncStatus === "syncing" ? "🔄" : syncStatus === "synced" ? "☁️" : syncStatus === "error" ? "⚠️" : ""}
              </span>
            )}

            {/* Auth button / user avatar */}
            {isSupabaseConfigured ? (
              user ? (
                <div className="relative">
                  <button
                    onClick={() => setShowUserMenu((v) => !v)}
                    className="w-9 h-9 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-lg hover:bg-emerald-500/30 transition-colors"
                  >
                    {profile.avatar || user.email?.[0]?.toUpperCase() || "U"}
                  </button>
                  {showUserMenu && (
                    <>
                      {/* Full-screen tap-to-close backdrop — rendered in a portal-like fixed layer */}
                      <div
                        className="fixed inset-0"
                        style={{ zIndex: 998 }}
                        onClick={() => setShowUserMenu(false)}
                      />
                      {/* Dropdown — above the backdrop */}
                      <div
                        className={`absolute right-0 top-11 w-56 rounded-2xl border shadow-xl p-2 ${
                          isDark ? "bg-[#111a14] border-white/10" : "bg-white border-black/10"
                        }`}
                        style={{ zIndex: 999 }}
                      >
                        <p className="text-xs opacity-50 px-3 py-1 truncate">{user.email}</p>
                        <div className="my-1 border-t border-white/10" />
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            setSyncStatus("syncing");
                            const ok = await pushToCloud(appData, user.id);
                            setSyncStatus(ok ? "synced" : "error");
                            setShowUserMenu(false);
                          }}
                          className="w-full text-left px-3 py-2 rounded-xl text-sm hover:bg-white/5 transition-colors flex items-center gap-2"
                        >
                          🔄 <span>Sync now</span>
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleSignOut(); }}
                          className="w-full text-left px-3 py-2 rounded-xl text-sm hover:bg-red-500/10 text-red-400 transition-colors flex items-center gap-2"
                        >
                          🚪 <span>Sign out</span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => setShowAuthModal(true)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${
                    isDark
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20"
                      : "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 hover:bg-emerald-500/20"
                  }`}
                >
                  ☁️ Sign in
                </button>
              )
            ) : null}

            {/* Theme toggle */}
            <button
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              className={`w-9 h-9 rounded-full flex items-center justify-center text-lg transition-all ${
                isDark ? "bg-white/10 hover:bg-white/20" : "bg-black/10 hover:bg-black/20"
              }`}
            >
              {isDark ? "☀️" : "🌙"}
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main
        className="max-w-lg mx-auto px-4 py-6"
        style={{ paddingBottom: "calc(5rem + env(safe-area-inset-bottom))" }}
      >
        {tab === "today" && <TodayTab />}
        {tab === "weekly" && <WeeklyTab />}
        {tab === "monthly" && <MonthlyTab />}
        {tab === "dhikr" && <DhikrTab />}
        {tab === "dua" && <DuaTab />}
        {tab === "dashboard" && <DashboardTab />}
        {tab === "profile" && (
          <ProfileTab
            profile={profile}
            onProfileChange={handleProfileChange}
            user={user}
            syncStatus={syncStatus}
            onSignOut={handleSignOut}
            onShowAuth={() => setShowAuthModal(true)}
            appData={appData}
            isDark={isDark}
          />
        )}
      </main>

      {/* Bottom Nav */}
      <nav
        className={`fixed bottom-0 left-0 right-0 border-t backdrop-blur-xl z-10 ${
          isDark
            ? "bg-[#0a0f0d]/90 border-white/10"
            : "bg-[#f0f7f4]/90 border-black/10"
        }`}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="max-w-lg mx-auto flex">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 flex flex-col items-center py-2 gap-0.5 transition-all ${
                tab === t.id
                  ? "text-emerald-400"
                  : isDark
                  ? "text-white/40 hover:text-white/60"
                  : "text-black/40 hover:text-black/60"
              }`}
            >
              <span className="text-lg">{t.icon}</span>
              <span className="text-[10px] font-medium">{t.label}</span>
              {tab === t.id && (
                <span className="w-1 h-1 rounded-full bg-emerald-400 mt-0.5" />
              )}
            </button>
          ))}
        </div>
      </nav>

      {/* ── SW Update Toast ─────────────────────────────────────────────── */}
      {swUpdateReady && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-sm"
          style={{ top: "calc(env(safe-area-inset-top) + 0.75rem)" }}
        >          <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-emerald-900/95 border border-emerald-500/40 shadow-2xl backdrop-blur-xl">
            <span className="text-xl">✨</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white">Update available</p>
              <p className="text-xs text-emerald-300/70">A new version of DeenHabit is ready</p>
            </div>
            <button
              onClick={applySwUpdate}
              className="px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white text-xs font-bold transition-colors flex-shrink-0"
            >
              Reload
            </button>
            <button
              onClick={() => setSwUpdateReady(false)}
              className="text-white/40 hover:text-white/70 text-xl leading-none flex-shrink-0"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* ── Auth Modal ──────────────────────────────────────────────────── */}
      {showAuthModal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowAuthModal(false);
              setAuthError(null);
              setAuthSuccess(null);
            }
          }}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className={`relative w-full max-w-sm rounded-3xl border p-6 shadow-2xl z-10 ${
              isDark ? "bg-[#0e1a12] border-white/10" : "bg-white border-black/10"
            }`}
          >
            <button
              onClick={() => { setShowAuthModal(false); setAuthError(null); setAuthSuccess(null); }}
              className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-xl"
            >×</button>

            <div className="text-center mb-6">
              <p className="text-3xl mb-2">🌙</p>
              <h2 className="text-xl font-bold">
                {authMode === "signup" ? "Create account" : authMode === "magic" ? "Magic link" : "Welcome back"}
              </h2>
              <p className="text-xs opacity-50 mt-1">
                {authMode === "signup"
                  ? "Save your progress across devices"
                  : authMode === "magic"
                  ? "We'll send a sign-in link to your email"
                  : "Sign in to sync your habits"}
              </p>
            </div>

            {/* Google OAuth */}
            {authMode !== "magic" && (
              <>
                <button
                  onClick={handleGoogleSignIn}
                  disabled={authLoading}
                  className={`w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl border font-semibold text-sm transition-all mb-4 disabled:opacity-50 ${
                    isDark ? "bg-white/5 border-white/15 hover:bg-white/10" : "bg-black/5 border-black/10 hover:bg-black/10"
                  }`}
                >
                  <svg viewBox="0 0 24 24" className="w-5 h-5 flex-shrink-0">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Continue with Google
                </button>
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex-1 h-px bg-white/10" />
                  <span className="text-xs opacity-40">or</span>
                  <div className="flex-1 h-px bg-white/10" />
                </div>
              </>
            )}

            <div className="space-y-3">
              <input
                type="email"
                placeholder="Email address"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !authLoading && handleAuthSubmit()}
                className={`w-full px-4 py-3 rounded-xl border text-sm outline-none transition-colors ${
                  isDark
                    ? "bg-white/5 border-white/10 focus:border-emerald-500/50 placeholder-white/30"
                    : "bg-black/5 border-black/10 focus:border-emerald-500/50 placeholder-black/30"
                }`}
              />
              {authMode !== "magic" && (
                <input
                  type="password"
                  placeholder="Password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !authLoading && handleAuthSubmit()}
                  className={`w-full px-4 py-3 rounded-xl border text-sm outline-none transition-colors ${
                    isDark
                      ? "bg-white/5 border-white/10 focus:border-emerald-500/50 placeholder-white/30"
                      : "bg-black/5 border-black/10 focus:border-emerald-500/50 placeholder-black/30"
                  }`}
                />
              )}
              {authError && (
                <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{authError}</p>
              )}
              {authSuccess && (
                <p className="text-xs text-emerald-400 bg-emerald-500/10 rounded-lg px-3 py-2">{authSuccess}</p>
              )}
              <button
                onClick={handleAuthSubmit}
                disabled={authLoading || !authEmail}
                className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-bold text-sm transition-colors"
              >
                {authLoading ? "Please wait…" : authMode === "magic" ? "Send magic link" : authMode === "signup" ? "Create account" : "Sign in"}
              </button>
            </div>

            <div className="flex flex-col items-center gap-2 mt-4 text-xs opacity-60">
              {authMode === "signin" && (<>
                <button onClick={() => { setAuthMode("signup"); setAuthError(null); setAuthSuccess(null); }} className="hover:opacity-100 underline">Don't have an account? Sign up</button>
                <button onClick={() => { setAuthMode("magic"); setAuthError(null); setAuthSuccess(null); }} className="hover:opacity-100 underline">Sign in with magic link instead</button>
              </>)}
              {authMode === "signup" && (
                <button onClick={() => { setAuthMode("signin"); setAuthError(null); setAuthSuccess(null); }} className="hover:opacity-100 underline">Already have an account? Sign in</button>
              )}
              {authMode === "magic" && (
                <button onClick={() => { setAuthMode("signin"); setAuthError(null); setAuthSuccess(null); }} className="hover:opacity-100 underline">Sign in with password instead</button>
              )}
            </div>
            <p className="text-center text-xs opacity-30 mt-4">
              Your data is always saved locally — signing in enables cross-device sync.
            </p>
          </div>
        </div>
      )}

    </div>
  );
}
