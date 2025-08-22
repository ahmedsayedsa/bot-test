import express from "express";
import makeWASocket, { useMultiFileAuthState } from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";

const app = express();
app.use(express.json());

let sock;

// ====== تهيئة واتساب ======
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");
  sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, qr } = update;
    if (qr) {
      qrcode.generate(qr, { small: true });
    }
    console.log("🔄 اتصال:", connection);
  });
}

// ====== استقبال Webhook من EasyOrder ======
app.post("/webhook", async (req, res) => {
  console.log("📩 Webhook request received:", JSON.stringify(req.body, null, 2));

  const order = req.body;

  if (!order.customer_phone) {
    console.log("❌ No customer phone in order data");
    return res.sendStatus(400);
  }

  // نص الرسالة المخصص
  const msg = `
🌟 أهلاً وسهلاً ${order.customer_name || "عميلنا العزيز"}

شكرًا لاختيارك اوتو سيرفس! تم استلام طلبك بنجاح 🎉

🆔 رقم الطلب: #${order.order_id || "N/A"}

🛍️ تفاصيل الطلب:
${order.items?.map(i => `* ${i.name} (${i.price})`).join("\n") || "لا يوجد منتجات"}

💰 الإجمالي: ${order.total || "غير محدد"}
📍 عنوان التوصيل: ${order.address || "غير متوفر"}

⚠️ ملاحظة مهمة: المعاينة غير متاحة وقت الاستلام
🔄 يُرجى تأكيد طلبك للبدء في التحضير والشحن
`;

  try {
    await sock.sendMessage(order.customer_phone + "@s.whatsapp.net", { text: msg });
    console.log("✅ رسالة اتبعت للعميل:", order.customer_phone);
  } catch (e) {
    console.error("❌ فشل في إرسال الرسالة:", e);
  }

  res.sendStatus(200);
});

// ====== تشغيل السيرفر ======
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  startBot();
});
