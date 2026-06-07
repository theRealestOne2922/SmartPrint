import { z } from 'zod';
import type { PrintJob } from './schema';

export const errorSchemas = {
  validation: z.object({ message: z.string(), field: z.string().optional() }),
  notFound: z.object({ message: z.string() }),
  rateLimit: z.object({ message: z.string() }),
};

export const api = {
  upload: {
    method: 'POST' as const,
    path: '/api/upload' as const,
    // File uploads use FormData, frontend does not serialize as JSON
    responses: {
      200: z.object({
        filePath: z.string(),
        fileName: z.string(),
        pageCount: z.number(),
      }),
      400: errorSchemas.validation,
      429: errorSchemas.rateLimit,
    },
  },
  printJobs: {
    create: {
      method: 'POST' as const,
      path: '/api/print-jobs' as const,
      input: z.object({
        studentName: z.string().optional(),
        fileName: z.string(),
        filePath: z.string(),
        pageCount: z.number(),
        colorMode: z.enum(['bw', 'color']),
        copies: z.number().min(1).max(10),
      }),
      responses: {
        201: z.custom<PrintJob>(),
        400: errorSchemas.validation,
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/print-jobs/:jobId' as const,
      responses: {
        200: z.custom<PrintJob>(),
        404: errorSchemas.notFound,
      },
    }
  }
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
