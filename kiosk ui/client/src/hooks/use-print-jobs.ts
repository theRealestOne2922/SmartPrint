import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// ============================================
// SUPABASE HOOKS
// ============================================

function mapJob(d: any) {
  return {
    id: d.id,
    jobId: d.job_id,
    studentName: d.student_name,
    fileName: d.file_name,
    filePath: d.file_path,
    pageCount: d.page_count,
    colorMode: d.color_mode,
    copies: d.copies,
    duplex: d.duplex,
    orientation: d.orientation || 'portrait',
    paperSize: d.paper_size || 'a3',
    price: d.price,
    status: d.status,
    createdAt: d.created_at,
  };
}

export function usePrintJob(printId: string | null, pollInterval?: number) {
  return useQuery({
    queryKey: ['print-job', printId],
    queryFn: async () => {
      if (!printId) return null;

      const { data, error } = await supabase
        .from('print_jobs')
        .select('*')
        .eq('job_id', printId)
        .order('id', { ascending: true });

      if (error || !data || data.length === 0) {
        throw new Error("Job not found");
      }

      return data.map(mapJob);
    },
    enabled: !!printId,
    refetchInterval: pollInterval || false,
    retry: false,
  });
}

export function useUpdatePrintJobStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ printId, status }: { printId: string; status: string }) => {
      const { data, error } = await supabase
        .from('print_jobs')
        .update({ status })
        .eq('job_id', printId)
        .select();

      if (error) {
        throw new Error(error.message || 'Failed to update status');
      }

      return data.map(mapJob);
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
      const dbUpdates: any = {};
      if (updates.pageCount !== undefined) dbUpdates.page_count = updates.pageCount;
      if (updates.colorMode !== undefined) dbUpdates.color_mode = updates.colorMode;
      if (updates.copies !== undefined) dbUpdates.copies = updates.copies;
      if (updates.duplex !== undefined) dbUpdates.duplex = updates.duplex;
      if (updates.orientation !== undefined) dbUpdates.orientation = updates.orientation;
      if (updates.paperSize !== undefined) dbUpdates.paper_size = updates.paperSize;

      const { data, error } = await supabase
        .from('print_jobs')
        .update(dbUpdates)
        .eq('id', id)
        .select();

      if (error) {
        throw new Error(error.message || 'Failed to update job details');
      }
      return data;
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
      const { error } = await supabase
        .from('print_jobs')
        .delete()
        .eq('id', id);

      if (error) {
        throw new Error(error.message || 'Failed to delete print job item');
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
