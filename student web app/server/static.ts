import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

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
