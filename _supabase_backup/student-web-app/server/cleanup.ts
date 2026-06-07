import { supabase } from "./supabase";

const BUCKET = "pdfs";

/**
 * Fetches the retention duration from system_settings. Defaults to 24 hours.
 */
async function getRetentionHours(): Promise<number> {
  try {
    const { data, error } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", "jobExpirationHours")
      .single();
    
    if (error || !data) return 24;
    const hours = parseInt(data.value, 10);
    return isNaN(hours) ? 24 : hours;
  } catch (e) {
    return 24;
  }
}

/**
 * Finds and deletes uploaded files and print jobs that have exceeded
 * the admin-configured retention duration. Also cleans up orphans.
 */
export async function cleanupExpiredJobs(): Promise<void> {
  const now = new Date();
  const label = `[cleanup] ${now.toLocaleTimeString()}`;
  const retentionHours = await getRetentionHours();
  const cutoffMs = retentionHours * 60 * 60 * 1000;
  const cutoffDate = new Date(now.getTime() - cutoffMs);

  console.log(`${label} 🧹 Running retention cleanup (Retention: ${retentionHours}h, Cutoff: ${cutoffDate.toISOString()})...`);

  try {
    // 1. Delete Expired Print Jobs & Their Files
    const { data: expiredJobs, error: fetchErr } = await supabase
      .from("print_jobs")
      .select("id, file_path")
      .lt("created_at", cutoffDate.toISOString());

    if (fetchErr) {
      console.error(`${label} ❌ Failed to fetch expired jobs:`, fetchErr.message);
    } else if (expiredJobs && expiredJobs.length > 0) {
      // Extract storage paths from public URLs
      const pathsToDelete: string[] = [];
      for (const job of expiredJobs) {
        if (!job.file_path) continue;
        const urlParts = job.file_path.split("/");
        const fileName = urlParts[urlParts.length - 1];
        if (fileName) pathsToDelete.push(`uploads/${fileName}`);
      }

      // Delete from DB
      const jobIds = expiredJobs.map(j => j.id);
      const { error: dbDeleteErr } = await supabase
        .from("print_jobs")
        .delete()
        .in("id", jobIds);

      if (dbDeleteErr) {
        console.error(`${label} ❌ Failed to delete expired jobs from DB:`, dbDeleteErr.message);
      } else {
        console.log(`${label} ✅ Deleted ${jobIds.length} expired job(s) from database.`);
      }

      // Delete files from storage
      if (pathsToDelete.length > 0) {
        const { error: storageDeleteErr } = await supabase.storage
          .from(BUCKET)
          .remove(pathsToDelete);
        
        if (storageDeleteErr) {
          console.error(`${label} ❌ Failed to delete files for expired jobs:`, storageDeleteErr.message);
        } else {
          console.log(`${label} ✅ Deleted ${pathsToDelete.length} expired file(s) from storage.`);
        }
      }
    } else {
      console.log(`${label} ✅ No expired jobs found.`);
    }

    // 2. Standard Orphan Cleanup (files in storage with no DB record)
    const { data: storageFiles } = await supabase.storage.from(BUCKET).list("uploads", { limit: 1000 });
    const { data: allJobs } = await supabase.from("print_jobs").select("file_path");
    
    if (storageFiles && allJobs) {
      const referencedPaths = new Set(allJobs.map((j) => j.file_path).filter(Boolean));
      const orphanPaths: string[] = [];
      const orphanCutoffMs = 3 * 60 * 60 * 1000; // 3 hours grace period for orphans

      // Compute the public URL base once instead of calling getPublicUrl() per file
      const { data: { publicUrl: baseUrl } } = supabase.storage.from(BUCKET).getPublicUrl("uploads/");

      for (const file of storageFiles) {
        if (file.name === ".emptyFolderPlaceholder") continue;
        
        const fileAgeMs = now.getTime() - new Date(file.created_at).getTime();
        if (fileAgeMs < orphanCutoffMs) continue;

        const storagePath = `uploads/${file.name}`;
        const publicUrl = `${baseUrl}${file.name}`;

        if (!referencedPaths.has(publicUrl)) {
          orphanPaths.push(storagePath);
        }
      }

      if (orphanPaths.length > 0) {
        await supabase.storage.from(BUCKET).remove(orphanPaths);
        console.log(`${label} 🧹 Deleted ${orphanPaths.length} orphan file(s) older than 3h.`);
      }
    }

  } catch (err: any) {
    console.error(`${label} ❌ Unexpected error during cleanup:`, err.message);
  }
}

/**
 * Starts the automatic cleanup scheduler.
 * Runs immediately on startup, then every 1 hour to check for expirations.
 */
export function startOrphanCleanupScheduler(): void {
  const intervalMs = 60 * 60 * 1000; // 1 hour

  console.log(`[cleanup] 🕐 Cleanup scheduler started (Runs every 1 hour).`);

  // Run once immediately on server start
  cleanupExpiredJobs();

  // Then repeat on interval
  setInterval(cleanupExpiredJobs, intervalMs);
}
