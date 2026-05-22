const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://mqqluwvemcuokqcchnii.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1xcWx1d3ZlbWN1b2txY2NobmlpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODkyNTAzNCwiZXhwIjoyMDk0NTAxMDM0fQ.LeKWAc38zSu13_sjllAtbd6kbWBJyk146JvDc9Dcu3w';

const supabase = createClient(supabaseUrl, supabaseKey);

async function runCleanup() {
  console.log("Starting deep cleanup of zombie files...");

  // 1. Delete old 'uploaded' jobs from DB
  const cutoffTime = new Date(Date.now() - 1000 * 60 * 60); // 1 hour ago
  
  const { data: oldJobs, error: err1 } = await supabase
    .from('print_jobs')
    .select('id, file_path')
    .eq('status', 'uploaded')
    .lt('created_at', cutoffTime.toISOString());

  if (err1) {
    console.error("Error fetching old jobs:", err1);
  } else {
    console.log(`Found ${oldJobs.length} old abandoned jobs in DB. Deleting...`);
    for (const job of oldJobs) {
      if (job.file_path && job.file_path.includes('/storage/v1/object/public/pdfs/')) {
        const storagePath = job.file_path.split('/storage/v1/object/public/pdfs/')[1];
        if (storagePath) {
          await supabase.storage.from('pdfs').remove([storagePath]);
        }
      }
      await supabase.from('print_jobs').delete().eq('id', job.id);
    }
    console.log(`Deleted ${oldJobs.length} old jobs.`);
  }

  // 2. Fetch all valid jobs from DB
  const { data: allJobs, error: err2 } = await supabase
    .from('print_jobs')
    .select('file_path');

  if (err2) {
    console.error("Error fetching all jobs:", err2);
    return;
  }

  const validPaths = new Set();
  for (const job of allJobs) {
    if (job.file_path && job.file_path.includes('/storage/v1/object/public/pdfs/')) {
      validPaths.add(job.file_path.split('/storage/v1/object/public/pdfs/')[1]);
    }
  }

  // 3. Delete orphaned files from storage bucket
  const { data: files, error: err3 } = await supabase.storage.from('pdfs').list('', { limit: 1000 });
  if (err3) {
    console.error("Error listing files:", err3);
    return;
  }

  const orphanedFiles = [];
  for (const file of files) {
    if (file.name !== '.emptyFolderPlaceholder' && !validPaths.has(file.name)) {
      orphanedFiles.push(file.name);
    }
  }

  console.log(`Found ${orphanedFiles.length} orphaned files in Storage Bucket. Deleting...`);
  if (orphanedFiles.length > 0) {
    // Delete in chunks of 50
    for (let i = 0; i < orphanedFiles.length; i += 50) {
      const chunk = orphanedFiles.slice(i, i + 50);
      await supabase.storage.from('pdfs').remove(chunk);
      console.log(`Deleted chunk of ${chunk.length} orphaned files.`);
    }
  }

  console.log("Deep cleanup complete.");
}

runCleanup();
