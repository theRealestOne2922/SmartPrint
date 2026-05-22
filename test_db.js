const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://mqqluwvemcuokqcchnii.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1xcWx1d3ZlbWN1b2txY2NobmlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5MjUwMzQsImV4cCI6MjA5NDUwMTAzNH0.v3JosAU55iIdboxeMXyfE5rptQo-GhBF1K10dWPwGgM');
supabase.from('system_settings').select('*').then(res => console.log(res));
