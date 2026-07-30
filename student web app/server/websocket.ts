import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import mongoose from 'mongoose';
import { sanitizeJob } from './security';

let wss: WebSocketServer;

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

        const message = JSON.stringify({
          type: 'JOB_UPDATE',
          job: {
            id: doc._id,
            jobId: doc.jobId,
            status: doc.status,
            fileName: doc.fileName,
            studentName: doc.studentName,
            pageCount: doc.pageCount,
            colorMode: doc.colorMode,
            copies: doc.copies,
            price: doc.price,
            createdAt: doc.createdAt,
          },
        });

        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(message);
          }
        });
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
  if (!wss) return;
  const message = JSON.stringify({ type: 'JOB_UPDATE', job: sanitizeJob(job) });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}
