import { z } from 'zod';
import { insertPrintJobSchema, printJobs } from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  printJobs: {
    getByPrintId: {
      method: 'GET' as const,
      path: '/api/print-jobs/:printId' as const,
      responses: {
        200: z.custom<typeof printJobs.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/print-jobs' as const,
      input: insertPrintJobSchema,
      responses: {
        201: z.custom<typeof printJobs.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    updateStatus: {
      method: 'PATCH' as const,
      path: '/api/print-jobs/:printId/status' as const,
      input: z.object({ status: z.string() }),
      responses: {
        200: z.custom<typeof printJobs.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
  },
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
