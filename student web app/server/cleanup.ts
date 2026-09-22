// Cleanup Scheduler — MongoDB Edition
import { PrintJob } from "./models/PrintJob";
import { SystemSetting } from "./models/SystemSetting";
import fs from "fs/promises";
import path from "path";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

// The file name on disk for a job's filePath. filePath is a full URL and,
// since download links became signed, carries a "?t=<token>" query — so the
// last path segment is "abc.pdf?t=…", which matches nothing on disk. That made
// the orphan sweep below treat every upload as unreferenced and delete it
// three hours after upload, and any job printed later than that failed with
// a 404. Parse it as a URL and take the real basename.
function storedFileName(filePath: string | null | undefined): string | null {
  if (!filePath) return null;
  try {
    return path.basename(new URL(filePath).pathname) || null;
  } catch {
    const noQuery = filePath.split("?")[0];
    return path.basename(noQuery) || null;
  }
}

/**
 * Fetches the retention duration from system_settings. Defaults to 24 hours.
 */
async function getRetentionHours(): Promise<number> {
  try {
    const setting = await SystemSetting.findOne({ key: "jobExpirationHours" });
    if (!setting) return 24;
    const hours = parseInt(setting.value, 10);
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
    const expiredJobs = await PrintJob.find({
      createdAt: { $lt: cutoffDate },
    }).select('_id filePath');

    if (expiredJobs && expiredJobs.length > 0) {
      // Extract storage paths from public URLs
      const pathsToDelete: string[] = [];
      for (const job of expiredJobs) {
        if (!job.filePath) continue;
        const fileName = storedFileName(job.filePath);
        if (fileName) pathsToDelete.push(path.join(UPLOADS_DIR, fileName));
      }

      // Delete from MongoDB
      const jobIds = expiredJobs.map(j => j._id);
      await PrintJob.deleteMany({ _id: { $in: jobIds } });
      console.log(`${label} ✅ Deleted ${jobIds.length} expired job(s) from database.`);

      // Delete files from local filesystem
      let deletedFiles = 0;
      for (const filePath of pathsToDelete) {
        try {
          await fs.unlink(filePath);
          deletedFiles++;
        } catch (e: any) {
          if (e.code !== 'ENOENT') {
            console.error(`${label} ❌ Failed to delete file ${filePath}:`, e.message);
          }
        }
      }
      console.log(`${label} ✅ Deleted ${deletedFiles} expired file(s) from storage.`);
    } else {
      console.log(`${label} ✅ No expired jobs found.`);
    }

    // 2. Standard Orphan Cleanup (files in local storage with no DB record)
    let storageFiles: string[] = [];
    try {
      storageFiles = await fs.readdir(UPLOADS_DIR);
    } catch (e: any) {
      if (e.code !== 'ENOENT') {
        console.error(`${label} ❌ Failed to read uploads directory:`, e.message);
      }
    }

    const allJobs = await PrintJob.find().select('filePath');
    
    if (storageFiles.length > 0 && allJobs) {
      const referencedFiles = new Set(allJobs.map((j) => storedFileName(j.filePath)).filter(Boolean));
      
      let deletedOrphans = 0;
      const orphanCutoffMs = 3 * 60 * 60 * 1000; // 3 hours grace period for orphans

      for (const fileName of storageFiles) {
        if (fileName === ".emptyFolderPlaceholder" || fileName === ".gitkeep") continue;
        
        const filePath = path.join(UPLOADS_DIR, fileName);
        
        try {
          const stats = await fs.stat(filePath);
          const fileAgeMs = now.getTime() - stats.mtime.getTime();
          
          if (fileAgeMs < orphanCutoffMs) continue;

          if (!referencedFiles.has(fileName)) {
            await fs.unlink(filePath);
            deletedOrphans++;
          }
        } catch (err: any) {
           console.error(`${label} ❌ Failed to process orphan ${fileName}:`, err.message);
        }
      }

      if (deletedOrphans > 0) {
        console.log(`${label} 🧹 Deleted ${deletedOrphans} orphan file(s) older than 3h.`);
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
