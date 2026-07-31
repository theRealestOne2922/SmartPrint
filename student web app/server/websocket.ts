import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import mongoose from 'mongoose';

let wss: WebSocketServer;

/**
 * Tells every connected client that a job changed, and nothing else.
 *
 * A connection to /ws needs no credentials — the kiosk is an unattended device
 * that cannot hold one, and the socket accepts any origin. So the broadcast
 * itself has to be worthless to a listener.
 *
 * It used to carry jobId, fileName and studentName to every open socket. jobId
 * is the print code, and the whole release model rests on that staying secret,
 * so anyone who opened this socket could sit and harvest live print codes and
 * exam paper filenames as staff created jobs — no guessing, and none of the
 * rate limiting on the lookup endpoint applied.
 *
 * Now it sends only the opaque document id, which grants nothing on its own:
 * editing or deleting a job still requires a job-session token bound to the
 * print code. Clients treat this as "something changed, refetch through the
 * authenticated endpoints".
 */
function broadcast(id: unknown): void {
  if (!wss) return;
  const message = JSON.stringify({ type: 'JOB_UPDATE', job: { id: String(id) } });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

/**
 * Initialize WebSocket server on the same HTTP server.
 * Watches MongoDB Change Streams on PrintJob collection
 * and broadcasts updates to connected clients (Kiosk UI).
 */
export function initWebSocket(httpServer: Server): void {
  wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws) => {
    console.log('[WebSocket] Client connected');
    ws.on('close', () => console.log('[WebSocket] Client disconnected'));
    ws.on('error', (err) => console.error('[WebSocket] Client error:', err.message));
  });

  // Watch MongoDB Change Stream for PrintJob updates
  try {
    const PrintJobModel = mongoose.model('PrintJob');
    const changeStream = PrintJobModel.watch([], { fullDocument: 'updateLookup' });

    changeStream.on('change', (change: any) => {
      if (
        change.operationType === 'update' ||
        change.operationType === 'replace'
      ) {
        const doc = change.fullDocument;
        if (!doc) return;
        broadcast(doc._id);
      }
    });

    changeStream.on('error', (err: any) => {
      console.error('[WebSocket] Change Stream error:', err.message);
    });

    console.log('[WebSocket] Server initialized with Change Stream');
  } catch (err: any) {
    // Change Streams require a replica set (MongoDB Atlas has this by default)
    console.warn(
      '[WebSocket] Change Stream unavailable (requires replica set):',
      err.message,
    );
    console.warn('[WebSocket] Falling back to manual broadcast mode');
  }
}

/**
 * Manually broadcast a job update to all connected WebSocket clients.
 * Used as a fallback when Change Streams aren't available.
 */
export function broadcastJobUpdate(job: any): void {
  // Same minimal payload as the Change Stream path. sanitizeJob strips the
  // encryption fields but keeps jobId, so sending a sanitized job here would
  // still have published the print code to every listener.
  broadcast(job?._id ?? job?.id);
}
