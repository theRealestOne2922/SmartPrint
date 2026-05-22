import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "https://mqqluwvemcuokqcchnii.supabase.co";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1xcWx1d3ZlbWN1b2txY2NobmlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5MjUwMzQsImV4cCI6MjA5NDUwMTAzNH0.v3JosAU55iIdboxeMXyfE5rptQo-GhBF1K10dWPwGgM";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
