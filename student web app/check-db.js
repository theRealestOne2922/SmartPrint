import { createClient } from '@supabase/supabase-js';

const supabaseUrl = "https://mqqluwvemcuokqcchnii.supabase.co";
const supabaseServiceKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1xcWx1d3ZlbWN1b2txY2NobmlpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODkyNTAzNCwiZXhwIjoyMDk0NTAxMDM0fQ.LeKWAc38zSu13_sjllAtbd6kbWBJyk146JvDc9Dcu3w";

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log('Fetching last 15 print jobs from Supabase...');
    const { data, error } = await supabase
        .from('print_jobs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(15);

    if (error) {
        console.error('Error fetching jobs:', error.message);
        return;
    }

    if (!data || data.length === 0) {
        console.log('No print jobs found in the database.');
        return;
    }

    console.log(`Found ${data.length} recent print jobs:`);
    data.forEach(job => {
        console.log(`- ID: ${job.id}, JobID: ${job.job_id}, File: "${job.file_name}", Status: "${job.status}", Created: ${job.created_at}`);
    });
}

run();
