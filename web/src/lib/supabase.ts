import { createClient } from "@supabase/supabase-js";

// The app only reads public catalog data, so it uses the anon key.
// Scrapers write with the service role key and never run in the browser.
export function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export type Program = {
  id: number;
  name: string;
  degree: string;
  concentration: string | null;
  school: { code: string; name: string };
};
