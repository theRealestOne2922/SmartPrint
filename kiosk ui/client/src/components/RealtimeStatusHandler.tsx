// Realtime Status Handler — WebSocket Edition
// Replaces Supabase Realtime (postgres_changes) with WebSocket connection.
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { WS_BASE } from "@/lib/api-config";

export function RealtimeStatusHandler() {
  const queryClient = useQueryClient();

  useEffect(() => {
    // Determine WebSocket URL based on current page location or WS_BASE
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = WS_BASE ? `${WS_BASE}/ws` : `${protocol}//${window.location.host}/ws`;

    console.log("[WebSocket] Connecting to", wsUrl);

    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_DELAY = 30000; // 30s max

    function connect() {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        reconnectAttempts = 0;
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'JOB_UPDATE') {
            // The broadcast deliberately carries no print code any more — it
            // used to, which published every code to anyone holding this socket
            // open. Invalidate the whole 'print-job' key prefix instead: this
            // screen only ever tracks one job, so refetching it is the same
            // work, and the refetch goes through the authenticated endpoint.
            queryClient.invalidateQueries({ queryKey: ['print-job'] });
            queryClient.invalidateQueries({ queryKey: ['confirmed-jobs'] });
          }
        } catch (err) {
          console.error("[WebSocket] Failed to parse message:", err);
        }
      };

      ws.onclose = (event) => {
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
