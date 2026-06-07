import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { startOrphanCleanupScheduler } from "./cleanup";
import { connectMongoDB } from "./mongodb";
import { initWebSocket } from "./websocket";
import { Admin } from "./models/Admin";
import { Teacher } from "./models/Teacher";
import { SystemSetting } from "./models/SystemSetting";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

/**
 * Seed default data on first run (admin, teacher, settings).
 */
async function seedDefaultData() {
  try {
    // Seed admin if none exists
    const adminCount = await Admin.countDocuments();
    if (adminCount === 0) {
      await Admin.create({ username: 'vit admin', passwordHash: 'admin123' });
      console.log('[seed] ✅ Created default admin user (vit admin / admin123)');
    }

    // Seed teacher if none exists
    const teacherCount = await Teacher.countDocuments();
    if (teacherCount === 0) {
      await Teacher.create({
        empId: '1001',
        name: 'Teacher Name',
        email: 'realme11421@gmail.com',
        department: 'CS',
      });
      console.log('[seed] ✅ Created default teacher');
    }

    // Seed settings if none exist
    const settingCount = await SystemSetting.countDocuments();
    if (settingCount === 0) {
      await SystemSetting.create([
        { key: 'jobExpirationHours', value: '24' },
        { key: 'maxFilesLimit', value: '5' },
      ]);
      console.log('[seed] ✅ Created default settings');
    }
  } catch (err: any) {
    console.error('[seed] Error seeding default data:', err.message);
  }
}

(async () => {
  // Connect to MongoDB FIRST, before registering routes
  await connectMongoDB();

  // Seed default data on first run
  await seedDefaultData();

  await registerRoutes(httpServer, app);

  // Initialize WebSocket relay for realtime updates (replaces Supabase Realtime)
  initWebSocket(httpServer);

  // Start the background job to clean up orphan files in Supabase Storage.
  startOrphanCleanupScheduler();

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  const host = process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1";
  httpServer.listen(port, host, () => {
    log(`serving on ${host}:${port}`);
  });
})();
