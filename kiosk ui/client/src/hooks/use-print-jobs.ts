// Kiosk Print Job Hooks — MongoDB Edition
// All Supabase database calls replaced with Express API fetch().
import { API_BASE } from "@/lib/api-config";
import { getKioskId } from "@/lib/kiosk-id";
// Mongoose returns camelCase fields, so the mapJob() function is simplified.
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// Job-session tokens, handed out by the server when a PIN lookup succeeds and
// required to edit or delete that job. Holding them in memory (not
// localStorage) means they die with the page, which suits a shared kiosk.
const jobSessions = new Map<string, string>();

function rememberSession(printId: string, res: Response) {
  const token = res.headers.get("X-Job-Session");
  if (token) jobSessions.set(printId, token);
}

// A confidential job needs proof the faculty ID was verified, not just the
// print code — otherwise a code glimpsed over someone's shoulder is enough to
// re-configure or delete their exam paper from anywhere. The screen already
// holds this token: it verifies on load before any control is reachable.
function releaseHeader(token?: string | null): HeadersInit {
  return token ? { "X-Release-Token": token } : {};
}

function sessionHeader(printId: string): HeadersInit {
  const token = jobSessions.get(printId);
  return token ? { "X-Job-Session": token } : {};
}

// Release tokens, kept in memory for the same reason as job sessions: a kiosk
// is a shared machine, and nothing that unlocks a document should outlive the
// person standing at it.
const releaseTokens = new Map<string, string>();

export function rememberRelease(printId: string, token: string) {
  releaseTokens.set(printId, token);
}

export function forgetRelease(printId: string) {
  releaseTokens.delete(printId);
}

// The server withholds the file name on a confidential job until faculty has
// been verified — a print code read over someone's shoulder should not reveal
// which paper is being printed. Sending the token back on lookups is what makes
// the real name appear once they have proved who they are.
function releaseHeaderFor(printId: string): HeadersInit {
  const token = releaseTokens.get(printId);
  return token ? { "X-Release-Token": token } : {};
}

// MongoDB/Mongoose already returns camelCase — no snake_case mapping needed
function mapJob(d: any) {
  return {
    id: d.id || d._id,
    jobId: d.jobId,
    studentName: d.studentName,
    fileName: d.fileName,
    filePath: d.filePath,
    pageCount: d.pageCount,
    colorMode: d.colorMode,
    copies: d.copies,
    duplex: d.duplex,
    orientation: d.orientation || 'portrait',
    paperSize: d.paperSize || 'a3',
    price: d.price,
    status: d.status,
    confidential: d.confidential,
    encrypted: d.encrypted,
    createdAt: d.createdAt,
  };
}

export function usePrintJob(printId: string | null, pollInterval?: number) {
  return useQuery({
    queryKey: ['print-job', printId],
    queryFn: async () => {
      if (!printId) return null;

      // Fetch via Express API (was: supabase.from('print_jobs').select('*').eq('job_id', printId))
      const res = await fetch(`${API_BASE}/api/jobs/lookup/${printId}`, {
        headers: releaseHeaderFor(printId),
      });
      if (!res.ok) {
        throw new Error("Job not found");
      }
      rememberSession(printId, res);

      const data = await res.json();
      return (Array.isArray(data) ? data : [data]).map(mapJob);
    },
    enabled: !!printId,
    refetchInterval: pollInterval || false,
    retry: false,
  });
}

// Verifies a Faculty ID for a confidential job entirely server-side and
// returns a short-lived release token — the correct ID is never sent to the browser.
export function useVerifyFacultyAccess() {
  return useMutation({
    mutationFn: async ({ printId, facultyId }: { printId: string; facultyId: string }) => {
      const res = await fetch(`${API_BASE}/api/jobs/${printId}/verify-faculty`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facultyId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Verification failed');
      }
      return data as { success: boolean; token: string };
    },
  });
}

export function useUpdatePrintJobStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ printId, status, releaseToken }: { printId: string; status: string; releaseToken?: string }) => {
      const kioskId = getKioskId();
      // Update via Express API (was: supabase.from('print_jobs').update({ status }).eq('job_id', printId))
      const res = await fetch(`${API_BASE}/api/jobs/${printId}/status`, {
        method: 'PATCH',
        // Same session token the edit and delete calls send. Without it the
        // print code alone was enough to cancel someone's job, or mark it
        // completed so it never printed, from anywhere.
        headers: { 'Content-Type': 'application/json', ...sessionHeader(printId) },
        // Which kiosk is releasing, so the job goes to the printer standing in
        // front of whoever typed the code rather than to whichever agent
        // happened to see the change first. Omitted entirely when this browser
        // has no kiosk identity — that is the single-kiosk behaviour the one
        // existing Pi still runs, and the server treats a missing kioskId as
        // exactly that rather than rejecting it.
        body: JSON.stringify({ status, releaseToken, ...(kioskId ? { kioskId } : {}) }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to update status');
      }

      const data = await res.json();
      return (Array.isArray(data) ? data : [data]).map(mapJob);
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['print-job', variables.printId]
      });
      queryClient.invalidateQueries({
        queryKey: ['confirmed-jobs']
      });
    },
  });
}

export function useUpdatePrintJobDetails() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, jobId, updates, releaseToken }: { id: string; jobId: string; updates: { pageCount?: number; colorMode?: 'bw' | 'color'; copies?: number; duplex?: boolean; orientation?: 'portrait' | 'landscape'; paperSize?: 'a4' | 'a3' }; releaseToken?: string | null }) => {
      // Update via Express API (was: supabase.from('print_jobs').update(...).eq('id', id))
      const res = await fetch(`${API_BASE}/api/jobs/${id}/details`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...sessionHeader(jobId), ...releaseHeader(releaseToken) },
        body: JSON.stringify(updates),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to update job details');
      }

      return await res.json();
    },
    // Optimistic update: immediately update the cached data so the list doesn't re-order
    onMutate: async ({ id, jobId, updates }) => {
      await queryClient.cancelQueries({ queryKey: ['print-job', jobId] });
      const previous = queryClient.getQueryData(['print-job', jobId]);

      queryClient.setQueryData(['print-job', jobId], (old: any[] | undefined) => {
        if (!old) return old;
        return old.map(job => {
          if (job.id === id) {
            return { ...job, ...updates };
          }
          return job;
        });
      });

      return { previous };
    },
    onError: (_err, variables, context) => {
      // Rollback on error
      if (context?.previous) {
        queryClient.setQueryData(['print-job', variables.jobId], context.previous);
      }
    },
    onSettled: (_data, _error, variables) => {
      // Delayed refetch to prevent optimistic update from being overridden too quickly
      setTimeout(() => {
        queryClient.invalidateQueries({
          queryKey: ['print-job', variables.jobId]
        });
      }, 300);
    }
  });
}

export function useDeletePrintJobItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, jobId, releaseToken }: { id: string; jobId: string; releaseToken?: string | null }) => {
      // Delete via Express API (was: supabase.from('print_jobs').delete().eq('id', id))
      const res = await fetch(`${API_BASE}/api/jobs/${id}`, {
        method: 'DELETE',
        headers: { ...sessionHeader(jobId), ...releaseHeader(releaseToken) },
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to delete print job item');
      }

      return { id };
    },
    onMutate: async ({ id, jobId }) => {
      await queryClient.cancelQueries({ queryKey: ['print-job', jobId] });
      const previous = queryClient.getQueryData(['print-job', jobId]);

      queryClient.setQueryData(['print-job', jobId], (old: any[] | undefined) => {
        if (!old) return old;
        return old.filter(job => job.id !== id);
      });

      return { previous };
    },
    onError: (_err, variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['print-job', variables.jobId], context.previous);
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['print-job', variables.jobId]
      });
    }
  });
}
