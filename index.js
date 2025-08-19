const express = require("express");
const fs = require("fs");
const makeWASocket = require("@whiskeysockets/baileys").default;
const { useMultiFileAuthState, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode");

let qrCodeData = null;

async function startBot() {
  // حذف مجلد auth_info عند كل تشغيل لضمان QR code جديد
  if (fs.existsSync("auth_info")) {
    console.log("⚠️ تم حذف مجلد auth_info لبدء جلسة جديدة.");
    fs.rmSync("auth_info", { recursive: true, force: true });
  }
  
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");
  const { version } = await fetchLatestBaileysVersion();
  
  const sock = makeWASocket({
    auth: state,
    version,
    printQRInTerminal: false
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) {
      qrCodeData = await qrcode.toDataURL(qr);
      console.log('📡 تم استلام QR code، جاهز للعرض.');
    }

    if (connection === 'close') {
      console.log('❌ الاتصال مقطوع، محاولة إعادة الاتصال...');
      // إضافة تأخير بسيط لمنع خطأ EADDRINUSE
      setTimeout(startBot, 5000); 
    } else if (connection === 'open') {
      console.log('✅ البوت متصل بنجاح!');
      qrCodeData = null; // مسح الـ QR بعد الاتصال
    }
  });
}

const app = express();

app.get("/", (req, res) => {
  if (qrCodeData) {
    const html = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; text-align: center;">
        <h1>امسح هذا الرمز باستخدام واتساب</h1>
        <img src="${qrCodeData}" alt="QR Code">
        <p>سيتم تحديث الصفحة تلقائياً عند الاتصال.</p>
      </div>
    `;
    res.send(html);
  } else {
    res.send("✅ البوت متصل وجاهز للعمل.");
  }
});

const PORT = process.env.PORT;
const HOST = '0.0.0.0'; 

app.listen(PORT, HOST, () => {
  console.log(`🚀 Webhook server شغال على http://${HOST}:${PORT}`);
});

startBot().catch(err => {
  console.error("❌ خطأ في بدء البوت:", err);
});