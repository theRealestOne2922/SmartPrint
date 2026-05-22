const functions = require("firebase-functions");
const Busboy = require("busboy");
const officeCrypto = require("officecrypto-tool");

/**
 * Firebase Cloud Function to decrypt password-protected Office files.
 * Receives multipart form data with 'file' and 'password' fields.
 * Returns the decrypted file buffer.
 */
exports.decrypt = functions
  .runWith({ memory: "512MB", timeoutSeconds: 60 })
  .https.onRequest((req, res) => {
    // CORS headers
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    if (req.method !== "POST") {
      return res.status(405).json({ message: "Method not allowed" });
    }

    const busboy = Busboy({ headers: req.headers });
    let fileBuffer = null;
    let password = null;
    let fileName = "";
    let mimeType = "";

    busboy.on("file", (fieldname, file, info) => {
      if (fieldname === "file") {
        fileName = info.filename || "document";
        mimeType = info.mimeType || "application/octet-stream";
        const chunks = [];
        file.on("data", (chunk) => chunks.push(chunk));
        file.on("end", () => {
          fileBuffer = Buffer.concat(chunks);
        });
      }
    });

    busboy.on("field", (fieldname, val) => {
      if (fieldname === "password") {
        password = val;
      }
    });

    busboy.on("finish", async () => {
      if (!fileBuffer) {
        return res.status(400).json({ message: "No file provided" });
      }
      if (!password) {
        return res.status(400).json({ message: "No password provided" });
      }

      // Check if the file is actually encrypted
      const isEncrypted = officeCrypto.isEncrypted(fileBuffer);
      if (!isEncrypted) {
        res.set("Content-Type", mimeType);
        res.set("Content-Disposition", `attachment; filename="${fileName}"`);
        return res.status(200).send(fileBuffer);
      }

      // Attempt decryption
      try {
        const decryptedBuffer = await officeCrypto.decrypt(fileBuffer, {
          password,
        });
        res.set("Content-Type", mimeType);
        res.set("Content-Disposition", `attachment; filename="${fileName}"`);
        return res.status(200).send(decryptedBuffer);
      } catch (err) {
        console.error("Decryption failed:", err.message);
        return res
          .status(401)
          .json({ message: "Incorrect password. Please try again." });
      }
    });

    busboy.end(req.rawBody);
  });
