import express, { type Express } from "express";
import fs from "fs";
import path from "path";

// The same policy Firebase Hosting serves for these pages, byte for byte.
//
// index.ts leaves helmet's CSP off because a default policy blocks the inline
// styles and the PDF preview, and switching one on blind risks breaking pages
// nobody re-tested. That reasoning holds — so this is not a new policy. It is
// the one already serving the identical build on smartprintvit.web.app, which
// means it has been exercised against every page in production.
//
// Without it, this origin served the whole app — including the admin screens —
// with no CSP at all, so any XSS was unmitigated for anyone who reached the app
// by the API hostname rather than the Firebase one. Keep the two in step: if
// firebase.json's policy changes, change this with it.
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; " +
  "connect-src 'self' https://140.245.224.137.nip.io wss://140.245.224.137.nip.io; " +
  "frame-src 'self' blob: https://docs.google.com; worker-src 'self' blob:; object-src 'none'; " +
  "base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests";

// The admin dashboard has one canonical home, and it is the Firebase origin
// that carries the policy above plus its own headers. This origin answered on
// /admin-login too, which meant a second, weaker door to the same account — and
// a convincing phishing surface on a hostname that really is ours.
//
// These 404 rather than redirect: nothing legitimate reaches the admin screens
// by this hostname, and a redirect would still confirm the path exists.
const ADMIN_ROUTES = /^\/admin(-login|-dashboard)?(\/|$)/;

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use((req, res, next) => {
    res.setHeader("Content-Security-Policy", CSP);
    if (ADMIN_ROUTES.test(req.path)) {
      return res.status(404).json({ message: "Not found" });
    }
    next();
  });

  app.use(express.static(distPath));

  // Kiosk SPA: any /kiosk-app/* route that isn't a real file → kiosk index.html
  app.use("/kiosk-app/{*path}", (_req, res) => {
    const kioskIndex = path.resolve(distPath, "kiosk-app", "index.html");
    if (fs.existsSync(kioskIndex)) {
      res.sendFile(kioskIndex);
    } else {
      // Fallback to main index if kiosk build isn't present
      res.sendFile(path.resolve(distPath, "index.html"));
    }
  });

  // Student SPA: everything else → main index.html
  app.use("/{*path}", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
