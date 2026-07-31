import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import crypto from "crypto";
import path from "path";
import { startOrphanCleanupScheduler } from "./cleanup";
import { connectMongoDB } from "./mongodb";
import { initWebSocket } from "./websocket";
import { Admin } from "./models/Admin";
import { SystemSetting } from "./models/SystemSetting";
import { hashPassword } from "./security";

const app = express();
const httpServer = createServer(app);

// CORS — allow Firebase Hosting frontend to talk to this Oracle VM backend
app.use(cors({
  origin: [
    "https://smartprintvit.web.app",
    "https://smartprintvit.firebaseapp.com",
    "http://localhost:5173",      // Vite dev server
    "http://localhost:5000",      // local Express
    "http://140.245.224.137",    // Oracle VM direct access
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Job-Session"],
  // The kiosk reads its job-session token off this header; without exposing it
  // the browser hides it from cross-origin JS.
  exposedHeaders: ["X-Job-Session"],
}));

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

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

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
        // Never let auth tokens or key material reach the log file.
        const REDACT = ["token", "wrappedKey", "wrappedKeyIv", "wrappedKeyAuthTag", "encIv", "encAuthTag"];
        const safe = JSON.stringify(capturedJsonResponse, (key, value) =>
          REDACT.includes(key) ? "[redacted]" : value,
        );
        logLine += ` :: ${safe}`;
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
    // Seed admin if none exists.
    //
    // This used to create "vit admin" / "admin123" — a working password to the
    // admin dashboard, written in the source of a public repository. Anyone who
    // opened the repo could sign in and read every print job.
    //
    // Credentials now come from the environment, or a random password is
    // generated and printed once. Nothing usable is committed either way.
    const adminCount = await Admin.countDocuments();
    if (adminCount === 0) {
      const username = process.env.ADMIN_USERNAME?.trim();
      const password = process.env.ADMIN_PASSWORD;

      if (username && password) {
        await Admin.create({ username, passwordHash: await hashPassword(password) });
        console.log(`[seed] ✅ Created admin "${username}" from ADMIN_USERNAME/ADMIN_PASSWORD.`);
      } else {
        const generated = crypto.randomBytes(18).toString('base64url');
        await Admin.create({ username: 'admin', passwordHash: await hashPassword(generated) });
        console.log('[seed] ⚠️  No admin existed. Created "admin" with a random password:');
        console.log(`[seed]     ${generated}`);
        console.log('[seed]     Sign in and change it — this is the only time it is shown,');
        console.log('[seed]     and it is sitting in the server log until you rotate the log.');
      }
    }

    // No default teacher. Seeding one meant a real, loginable account with a
    // password committed to the repo. Staff register themselves.

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
