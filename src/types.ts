export type Mode = "annual" | "ramadan";
export type Theme = "light" | "dark";
export type Tab = "today" | "weekly" | "monthly" | "dhikr" | "dua" | "dashboard" | "profile";

export type Madhab = "Hanafi" | "Shafi'i" | "Maliki" | "Hanbali";
export type CalcMethod = 1 | 2 | 3 | 4 | 5 | 15; // Aladhan method IDs

export interface UserProfile {
  displayName: string;
  kunyah: string;
  avatar: string;          // emoji
  gender: "male" | "female" | "unspecified";
  niyyah: string;
  madhab: Madhab;
  calcMethod: CalcMethod;
  homeCity: string;
  homeLat: number;
  homeLng: number;
  ramadanStartDate: string; // YYYY-MM-DD
  iftarReminderMins: number;  // 0 = off
  suhoorReminderMins: number; // 0 = off
  quranGoal: number;
  dhikrTarget: number;
  joinedAt: string; // ISO date string
}

export interface Prayer {
  id: string;
  name: string;
  arabic: string;
  fard: boolean;
  sunnah: boolean;
}

export interface LocationInfo {
  lat: number;
  lng: number;
  city: string;
  country: string;
}

export interface PrayerTimes {
  Fajr: string;
  Sunrise: string;
  Dhuhr: string;
  Asr: string;
  Maghrib: string;
  Isha: string;
  date: string;
  location: string;
}

export interface DayData {
  date: string;
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

export interface AppData {
  days: { [date: string]: DayData };
  quranGoal: number;
  dhikrTarget: number;
}
