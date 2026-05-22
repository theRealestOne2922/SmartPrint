/**
 * SmartPrint — Orphan File Cleanup Script
 * 
 * Finds files in Supabase Storage that have no matching print_jobs entry
 * and deletes them. Safe to run anytime.
 * 
 * Usage: node cleanup-orphans.js
 *        node cleanup-orphans.js --dry-run    (preview only, no deletes)
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BUCKET = 'pdfs';
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   🧹 SmartPrint Orphan Cleanup              ║');
  console.log(`║   Mode: ${DRY_RUN ? 'DRY RUN (no deletes)' : '🔴 LIVE (will delete)'}           ║`);
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  // 1. Get all files from Supabase Storage
  console.log('📂 Listing all files in storage...');
  const { data: storageFiles, error: listErr } = await supabase.storage
    .from(BUCKET)
    .list('uploads', { limit: 1000, sortBy: { column: 'created_at', order: 'asc' } });

  if (listErr) {
    console.error('❌ Failed to list storage files:', listErr.message);
    process.exit(1);
  }

  if (!storageFiles || storageFiles.length === 0) {
    console.log('✅ No files in storage. Nothing to clean up.');
    return;
  }

  console.log(`   Found ${storageFiles.length} file(s) in storage.`);

  // 2. Get all file_path values from print_jobs
  console.log('🗄️  Fetching all print jobs from database...');
  const { data: jobs, error: jobsErr } = await supabase
    .from('print_jobs')
    .select('file_path');

  if (jobsErr) {
    console.error('❌ Failed to fetch print jobs:', jobsErr.message);
    process.exit(1);
  }

  // Build a set of referenced file paths for fast lookup
  const referencedPaths = new Set(
    (jobs || []).map(j => j.file_path).filter(Boolean)
  );

  console.log(`   Found ${jobs?.length || 0} print job(s) in database.`);
  console.log('');

  // 3. Find orphans — files in storage not referenced by any job
  const orphans = [];
  for (const file of storageFiles) {
    if (file.name === '.emptyFolderPlaceholder') continue; // skip placeholder

    const storagePath = `uploads/${file.name}`;
    const { data: { publicUrl } } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(storagePath);

    // Check if ANY job references this file
    const isReferenced = referencedPaths.has(publicUrl);

    if (!isReferenced) {
      const ageMs = Date.now() - new Date(file.created_at).getTime();
      const ageHours = (ageMs / (1000 * 60 * 60)).toFixed(1);
      orphans.push({ name: file.name, path: storagePath, ageHours, size: file.metadata?.size });
    }
  }

  if (orphans.length === 0) {
    console.log('✅ No orphan files found. Storage is clean!');
    return;
  }

  console.log(`🗑️  Found ${orphans.length} orphan file(s):`);
  console.log('');
  for (const o of orphans) {
    const sizeKB = o.size ? `${(o.size / 1024).toFixed(1)} KB` : 'unknown size';
    console.log(`   • ${o.name} (${sizeKB}, ${o.ageHours}h old)`);
  }
  console.log('');

  if (DRY_RUN) {
    console.log('🔵 DRY RUN — no files were deleted. Run without --dry-run to delete.');
    return;
  }

  // 4. Delete orphans
  console.log('🔴 Deleting orphan files...');
  const pathsToDelete = orphans.map(o => o.path);
  const { error: deleteErr } = await supabase.storage
    .from(BUCKET)
    .remove(pathsToDelete);

  if (deleteErr) {
    console.error('❌ Delete failed:', deleteErr.message);
    process.exit(1);
  }

  console.log(`✅ Deleted ${orphans.length} orphan file(s). Storage is clean!`);
  console.log('');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
