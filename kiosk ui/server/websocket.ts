import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import mongoose from 'mongoose';
import { sanitizeJob } from './security';

let wss: WebSocketServer;

/**
 * Initialize WebSocket server for the Kiosk UI.
 * Watches MongoDB Change Streams on PrintJob collection
 * and broadcasts updates to connected Kiosk browser clients.
 */
export function initWebSocket(httpServer: Server): void {
  wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws) => {
    console.log('[WebSocket] Kiosk client connected');
    ws.on('close', () => console.log('[WebSocket] Kiosk client disconnected'));
    ws.on('error', (err) => console.error('[WebSocket] Client error:', err.message));
  });

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

    console.log('[WebSocket] Kiosk server initialized with Change Stream');
  } catch (err: any) {
    console.warn(
      '[WebSocket] Change Stream unavailable (requires replica set):',
      err.message,
    );
  }
}

export function broadcastJobUpdate(job: any): void {
  if (!wss) return;
  const message = JSON.stringify({ type: 'JOB_UPDATE', job: sanitizeJob(job) });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}
