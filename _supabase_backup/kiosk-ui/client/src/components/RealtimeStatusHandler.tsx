import { useEffect } from "react";
import { useLocation } from "wouter";
import { supabase } from "@/lib/supabase";
import { useQueryClient } from "@tanstack/react-query";

export function RealtimeStatusHandler() {
  const [location] = useLocation();
  const queryClient = useQueryClient();

  useEffect(() => {
    console.log("Supabase Realtime started listening...");
    
    const channel = supabase
      .channel('kiosk_updates')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'print_jobs'
        },
        (payload) => {
          const { new: job } = payload;
          console.log(`Realtime update for job ${job.job_id}: ${job.status}`);

          // Only invalidate queries so the PrintingScreen can react via polling
          // Do NOT auto-navigate — the user must enter their PIN first
          queryClient.invalidateQueries({ queryKey: ['print-job', job.job_id] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return null;
}
