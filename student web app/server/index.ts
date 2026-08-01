import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
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

// Nginx terminates TLS and proxies to this process, so without this every
// request appears to come from 127.0.0.1. That quietly broke every rate limit —
// they all shared a single bucket, so one attacker's failed attempts locked out
// real staff, while the per-attacker throttling we thought we had did not exist.
// Any IP-based rule is meaningless until this is set. One hop: nginx.
// Nginx already sends X-Forwarded-For (checked in sites-enabled/smartprint).
app.set("trust proxy", 1);

// The server sent no security headers at all, and advertised itself with
// "X-Powered-By: Express". Two of these matter concretely here:
//   frameguard  — the admin dashboard could be framed by another site and
//                 clicked through invisibly
//   noSniff     — an uploaded file served from /uploads could be interpreted as
//                 something other than its declared type by an older browser
//
// contentSecurityPolicy and crossOriginEmbedderPolicy are off deliberately.
// This process also serves the built frontend and the kiosk, and a default CSP
// blocks their inline styles and the PDF preview. A real CSP is worth doing,
// but it needs testing against every page rather than being switched on blind.
//
// crossOriginResourcePolicy is cross-origin because the frontend on
// smartprintvit.web.app fetches uploaded documents from this host to preview
// them; same-origin would break the print wizard.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    hsts: { maxAge: 15552000, includeSubDomains: true },
    referrerPolicy: { policy: "no-referrer" },
  })
);
const httpServer = createServer(app);

// CORS — allow Firebase Hosting frontend to talk to this Oracle VM backend
app.use(cors({
  origin: [
    "https://smartprintvit.web.app",
    "https://smartprintvit.firebaseapp.com",
    "http://140.245.224.137",    // Oracle VM direct access
    // Dev origins only outside production. Leaving localhost permitted on the
    // live API let any page running on a developer's machine call it directly.
    ...(process.env.NODE_ENV === "production"
      ? []
      : ["http://localhost:5173", "http://localhost:5000"]),
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Job-Session"],
  // The kiosk reads its job-session token off this header; without exposing it
  // the browser hides it from cross-origin JS.
  exposedHeaders: ["X-Job-Session"],
}));

// 100kb is express.json's own default; stating it makes the bound visible
// rather than incidental. rawBody used to be captured here for every request
// and was never read by anything — it just kept a second copy of every body.
app.use(express.json({ limit: "100kb" }));

app.use(express.urlencoded({ extended: false, limit: "100kb" }));

// Uploaded files are NOT served from here. There used to be a bare
// express.static mount on this line, and because it ran before registerRoutes
// it took precedence — so any access check added alongside the routes would
// have been dead code while this quietly served every document to anyone.
// The guarded handler lives in routes.ts.

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
