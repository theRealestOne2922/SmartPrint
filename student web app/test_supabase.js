import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://mqqluwvemcuokqcchnii.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1xcWx1d3ZlbWN1b2txY2NobmlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5MjUwMzQsImV4cCI6MjA5NDUwMTAzNH0.v3JosAU55iIdboxeMXyfE5rptQo-GhBF1K10dWPwGgM';

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const { data, error } = await supabase.from('system_settings').select('*');
  console.log('Data:', data);
  console.log('Error:', error);
}

test();
