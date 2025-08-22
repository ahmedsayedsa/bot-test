// index.js
const express = require("express")
const makeWASocket = require("@whiskeysockets/baileys").default
const { useMultiFileAuthState } = require("@whiskeysockets/baileys")
const pino = require("pino")

const app = express()
app.use(express.json())

let sock

// 🚀 تشغيل واتساب بوت
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("session")
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: "silent" })
    })

    sock.ev.on("creds.update", saveCreds)

    sock.ev.on("connection.update", (update) => {
        const { connection, qr } = update
        if (qr) {
            console.log("📌 اعمل سكان للكود ده بالواتساب:", qr)
        }
        if (connection === "open") {
            console.log("✅ البوت متصل بالواتساب")
        }
    })
}

// 📩 API لإرسال رسالة تأكيد الطلب
app.post("/send-order", async (req, res) => {
    const { number, name, orderId, items, total, address } = req.body
    if (!sock) return res.status(500).json({ error: "⚠️ البوت مش متصل بالواتساب" })

    try {
        const jid = number.includes("@s.whatsapp.net") ? number : `${number}@s.whatsapp.net`

        // ✨ الرسالة المخصصة
        const messageText = `
🌟 أهلاً وسهلاً ${name}

شكرًا لاختيارك اوتو سيرفس! تم استلام طلبك بنجاح 🎉

🆔 رقم الطلب: #${orderId}

🛍️ تفاصيل الطلب:
${items.map(item => `* ${item}`).join("\n")}

💰 الإجمالي: ${total}
📍 عنوان التوصيل: ${address}

⚠️ ملاحظة مهمة: المعاينة غير متاحة وقت الاستلام
🔄 يُرجى تأكيد طلبك للبدء في التحضير والشحن
        `.trim()

        await sock.sendMessage(jid, { text: messageText })

        console.log("📨 تم إرسال الرسالة:", messageText)
        res.json({ success: true, sent: messageText })
    } catch (err) {
        console.error("❌ خطأ أثناء الإرسال:", err)
        res.status(500).json({ error: "فشل الإرسال" })
    }
})

const PORT = process.env.PORT || 5000
app.listen(PORT, () => {
    console.log(`🚀 Webhook server شغال على http://localhost:${PORT}`)
    startBot()
})
