const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const makeWASocket = require("@whiskeysockets/baileys").default;
const { useMultiFileAuthState, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode"); // إضافة مكتبة qrcode

let qrCodeData = null; // متغير لحفظ بيانات الـ QR code

async function startBot() {
  // حذف مجلد auth_info القديم عند كل تشغيل
  if (fs.existsSync("auth_info")) {
    console.log("⚠️ تم حذف مجلد auth_info لتسجيل دخول جديد.");
    fs.rmSync("auth_info", { recursive: true, force: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState("auth_info");
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    auth: state,
    version,
    printQRInTerminal: false // تعطيل ظهور الـ QR في الـ Terminal
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    console.log(`🔗 حالة الاتصال: ${connection}`);

    if (qr) {
      console.log('📡 تم استلام QR code. سيتم عرضه على الويب.');
      qrCodeData = await qrcode.toDataURL(qr); // تحويل الـ QR code إلى صورة
    }

    if (connection === 'close') {
      console.log('❌ الاتصال مقطوع، محاولة إعادة الاتصال...');
      // إعادة تشغيل البوت بالكامل
      startBot(); 
    } else if (connection === 'open') {
      console.log('✅ البوت متصل بنجاح!');
      qrCodeData = null; // مسح الـ QR code بمجرد الاتصال
    }
  });

  const app = express();
  
  app.use(bodyParser.json({ limit: '50mb' }));
  app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
  app.use(bodyParser.raw({ type: 'application/json' }));
  app.use(bodyParser.text({ type: 'text/plain' }));

  // Route جديد لعرض الـ QR code
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
      res.json({
        message: "🤖 WhatsApp Bot is running and connected! 🎉",
        status: "✅ Connected",
        endpoints: {
          webhook: "/webhook (POST)"
        }
      });
    }
  });

  // Routes الخاصة بمعالجة الـ webhook كما هي
  app.all("/webhook", async (req, res) => {
    // ... الكود الخاص بك لاستقبال الطلبات ومعالجتها ...
    // (بما في ذلك الحفظ في ملفات JSON)
  });

  const PORT = process.env.PORT || 5000;
  const HOST = '0.0.0.0'; 
  
  app.listen(PORT, HOST, () => {
    console.log(`🚀 Webhook server شغال على http://${HOST}:${PORT}`);
    console.log(`🌐 Public URL: ${process.env.RENDER_EXTERNAL_HOSTNAME || 'Localhost'}`);
  });

}

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

startBot().catch(err => {
  console.error("❌ خطأ في بدء البوت:", err);
});