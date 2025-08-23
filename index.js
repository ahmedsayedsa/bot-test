import express from "express";
import makeWASocket, { useMultiFileAuthState } from "@adiwajshing/baileys";
import { Boom } from "@hapi/boom";
import { Storage } from "@google-cloud/storage";
import fs from "fs";
import path from "path";

// إعداد Google Cloud Storage
const storage = new Storage();
const bucketName = process.env.SESSION_BUCKET || "whatsapp-sessions-bucket";
const sessionFile = "session.json";

// تحميل/حفظ الجلسة من/إلى GCS
async function loadSession() {
  try {
    const file = storage.bucket(bucketName).file(sessionFile);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [contents] = await file.download();
    return JSON.parse(contents.toString());
  } catch (err) {
    console.error("❌ Failed to load session:", err);
    return null;
  }
}

async function saveSession(data) {
  try {
    const file = storage.bucket(bucketName).file(sessionFile);
    await file.save(JSON.stringify(data));
    console.log("✅ Session saved to GCS");
  } catch (err) {
    console.error("❌ Failed to save session:", err);
  }
}

const app = express();
app.use(express.json());

let sock;

async function startBot() {
  console.log("🚀 Starting WhatsApp bot...");

  const sessionData = await loadSession();
  const { state, saveCreds } = await useMultiFileAuthState("auth");

  if (sessionData) {
    fs.writeFileSync(
      path.join("auth", "creds.json"),
      JSON.stringify(sessionData, null, 2)
    );
  }

  sock = makeWASocket({
    printQRInTerminal: true,
    auth: state,
  });

  sock.ev.on("creds.update", async (creds) => {
    await saveCreds();
    await saveSession(creds);
  });

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) console.log("📌 Scan this QR:", qr);

    if (connection === "close") {
      const reason = new Boom(lastDisconnect?.error)?.output.statusCode;
      console.log("❌ Connection closed. Reason:", reason);
      startBot();
    } else if (connection === "open") {
      console.log("✅ Bot connected to WhatsApp!");
    }
  });
}

// API test endpoint
app.get("/", (req, res) => {
  res.json({
    status: "✅ Bot running",
    connected: !!sock,
  });
});

// Webhook لاستقبال الأوردرات من EasyOrder
app.post("/webhook", async (req, res) => {
  try {
    const { number, message } = req.body;
    if (!sock) {
      return res.status(500).json({ error: "❌ Bot not connected" });
    }
    await sock.sendMessage(number + "@s.whatsapp.net", { text: message });
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Webhook error:", err);
    res.status(500).json({ error: "Webhook failed" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌍 Server running on http://0.0.0.0:${PORT}`);
  startBot();
});
