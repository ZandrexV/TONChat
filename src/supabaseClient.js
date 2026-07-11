import { createClient } from "@supabase/supabase-js";

// These come from environment variables (set locally in .env,
// and in Cloudflare Pages under Settings > Environment variables)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "Missing Supabase env vars. Check your .env file (see .env.example)."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
