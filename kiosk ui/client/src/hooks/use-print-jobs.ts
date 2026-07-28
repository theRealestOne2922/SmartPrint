// ─── Kiosk Print Job Hooks — MongoDB Edition ───
// All Supabase database calls replaced with Express API fetch().
import { API_BASE } from "@/lib/api-config";
// Mongoose returns camelCase fields, so the mapJob() function is simplified.
// Original version backed up in _supabase_backup/
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

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
      const res = await fetch(`${API_BASE}/api/jobs/lookup/${printId}`);
      if (!res.ok) {
        throw new Error("Job not found");
      }

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
      // Update via Express API (was: supabase.from('print_jobs').update({ status }).eq('job_id', printId))
      const res = await fetch(`${API_BASE}/api/jobs/${printId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, releaseToken }),
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
    mutationFn: async ({ id, jobId, updates }: { id: string; jobId: string; updates: { pageCount?: number; colorMode?: 'bw' | 'color'; copies?: number; duplex?: boolean; orientation?: 'portrait' | 'landscape'; paperSize?: 'a4' | 'a3' } }) => {
      // Update via Express API (was: supabase.from('print_jobs').update(...).eq('id', id))
      const res = await fetch(`${API_BASE}/api/jobs/${id}/details`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
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
    mutationFn: async ({ id, jobId }: { id: string; jobId: string }) => {
      // Delete via Express API (was: supabase.from('print_jobs').delete().eq('id', id))
      const res = await fetch(`${API_BASE}/api/jobs/${id}`, {
        method: 'DELETE',
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
