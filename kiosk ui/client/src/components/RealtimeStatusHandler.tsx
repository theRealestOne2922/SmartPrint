// ─── Realtime Status Handler — WebSocket Edition ───
// Replaces Supabase Realtime (postgres_changes) with WebSocket connection.
// Original version backed up in _supabase_backup/
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

export function RealtimeStatusHandler() {
  const queryClient = useQueryClient();

  useEffect(() => {
    // Determine WebSocket URL based on current page location
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    console.log("[WebSocket] Connecting to", wsUrl);

    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_DELAY = 30000; // 30s max

    function connect() {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log("[WebSocket] Connected — listening for job updates");
        reconnectAttempts = 0;
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'JOB_UPDATE' && data.job) {
            console.log(`[WebSocket] Job update: ${data.job.jobId} → ${data.job.status}`);

            // Invalidate relevant React Query caches so components re-fetch
            queryClient.invalidateQueries({ queryKey: ['print-job', data.job.jobId] });
            queryClient.invalidateQueries({ queryKey: ['confirmed-jobs'] });
          }
        } catch (err) {
          console.error("[WebSocket] Failed to parse message:", err);
        }
      };

      ws.onclose = (event) => {
        console.log(`[WebSocket] Disconnected (code: ${event.code}). Reconnecting...`);

        // Exponential backoff reconnect
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
        reconnectAttempts++;

        reconnectTimer = setTimeout(connect, delay);
      };

      ws.onerror = (err) => {
        console.error("[WebSocket] Error:", err);
        ws.close();
      };
    }

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      if (ws) {
        ws.close();
      }
    };
  }, [queryClient]);

  return null;
}
