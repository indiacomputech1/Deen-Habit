import { createClient, type User, type Session } from "@supabase/supabase-js";
import type { AppData, UserProfile } from "./types";

// ─── Supabase client ──────────────────────────────────────────────────────────
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true },
      })
    : null;

export const isSupabaseConfigured = !!supabase;

// ─── Auth helpers ─────────────────────────────────────────────────────────────

export async function signInWithGoogle() {
  if (!supabase) throw new Error("Supabase not configured");
  return supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin },
  });
}

export async function signInWithEmail(email: string, password: string) {
  if (!supabase) throw new Error("Supabase not configured");
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signUpWithEmail(email: string, password: string) {
  if (!supabase) throw new Error("Supabase not configured");
  return supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: window.location.origin },
  });
}

export async function signInMagicLink(email: string) {
  if (!supabase) throw new Error("Supabase not configured");
  return supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
}

export async function signOut() {
  if (!supabase) return;
  return supabase.auth.signOut();
}

export async function getSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export type { User, Session };

// ─── Habit data sync ─────────────────────────────────────────────────────────

export async function pushToCloud(data: AppData, userId: string): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { error } = await supabase.from("habit_data").upsert(
      { user_id: userId, payload: data, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
    return !error;
  } catch {
    return false;
  }
}

export async function pullFromCloud(userId: string): Promise<AppData | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("habit_data")
      .select("payload, updated_at")
      .eq("user_id", userId)
      .single();
    if (error || !data) return null;
    return data.payload as AppData;
  } catch {
    return null;
  }
}

export function mergeAppData(local: AppData, remote: AppData): AppData {
  const mergedDays = { ...remote.days };
  for (const [date, localDay] of Object.entries(local.days)) {
    const remoteDay = remote.days[date];
    if (!remoteDay) {
      mergedDays[date] = localDay;
    } else {
      const localScore =
        Object.values(localDay.prayers).filter((p) => p.fard).length +
        (localDay.morningAdhkar ? 1 : 0) +
        (localDay.eveningAdhkar ? 1 : 0);
      const remoteScore =
        Object.values(remoteDay.prayers).filter((p) => p.fard).length +
        (remoteDay.morningAdhkar ? 1 : 0) +
        (remoteDay.eveningAdhkar ? 1 : 0);
      mergedDays[date] = localScore >= remoteScore ? localDay : remoteDay;
    }
  }
  return { days: mergedDays, quranGoal: local.quranGoal, dhikrTarget: local.dhikrTarget };
}

// ─── Profile sync ─────────────────────────────────────────────────────────────
// Stored in a separate `profiles` table for clean separation.
// Schema: id (uuid pk), user_id (uuid unique fk), profile (jsonb), updated_at

export async function pushProfile(profile: UserProfile, userId: string): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { error } = await supabase.from("profiles").upsert(
      { user_id: userId, profile, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
    return !error;
  } catch {
    return false;
  }
}

export async function pullProfile(userId: string): Promise<UserProfile | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("profile")
      .eq("user_id", userId)
      .single();
    if (error || !data) return null;
    return data.profile as UserProfile;
  } catch {
    return null;
  }
}

