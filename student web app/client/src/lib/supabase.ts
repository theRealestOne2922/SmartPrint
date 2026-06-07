// ─── Supabase Client — STORAGE ONLY ───
// Database queries now go through Express API → MongoDB.
// This client is kept ONLY for Supabase Storage file uploads.
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "https://mqqluwvemcuokqcchnii.supabase.co";
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1xcWx1d3ZlbWN1b2txY2NobmlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5MjUwMzQsImV4cCI6MjA5NDUwMTAzNH0.v3JosAU55iIdboxeMXyfE5rptQo-GhBF1K10dWPwGgM";

if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
}

export const supabase = createClient(supabaseUrl, supabaseKey);
