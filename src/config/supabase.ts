import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_SERVICE_KEY, SUPABASE_URL } from "./env.js";

let client: SupabaseClient | null = null;
if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
  client = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

/** `null` when SUPABASE_URL/SUPABASE_SERVICE_KEY aren't set — the community mirror is entirely optional. */
export function supabaseClient(): SupabaseClient | null {
  return client;
}
