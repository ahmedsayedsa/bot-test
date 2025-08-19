const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const makeWASocket = require("@whiskeysockets/baileys").default;
const { useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = require("@whiskeysockets/baileys");
const P = require("pino");

let isWhatsappConnected = false;
let connectingPhoneNumber = null;

async function startBot() {
    // حذف مجلد auth_info عند كل تشغيل لضمان جلسة جديدة
    if (fs.existsSync("auth_info")) {
        console.log("⚠️ تم حذف مجلد auth_info لبدء جلسة جديدة.");
        fs.rmSync("auth_info", { recursive: true, force: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState("auth_info");
    const { version } = await fetchLatestBaileysVersion();
    
    const logger = P({ level: "silent" });
    
    const sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        version,
        logger,
        printQRInTerminal: false,
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;
        console.log(`🔗 حالة الاتصال: ${connection}`);

        if (connection === 'close') {
            isWhatsappConnected = false;
            console.log('❌ الاتصال مقطوع، محاولة إعادة الاتصال...');
            setTimeout(() => startBot(), 5000); 
        } else if (connection === 'open') {
            isWhatsappConnected = true;
            console.log('✅ البوت متصل بنجاح!');
        }
    });

    // إذا كان هناك رقم هاتف لربطه
    if (connectingPhoneNumber) {
        try {
            const { qr, code } = await sock.linkWithPhoneNumber(connectingPhoneNumber);
            console.log(`📡 تم إرسال طلب الربط. يرجى تأكيد الاتصال على هاتفك.`);
            console.log(`Code: ${code}`); // قد يظهر كود لتأكيد إضافي
        } catch (e) {
            console.error("❌ فشل الربط برقم الهاتف:", e.message);
        }
        connectingPhoneNumber = null;
    }
}

const app = express();
app.use(bodyParser.json({ limit: '50mb' }));

// Route الرئيسي لعرض حالة البوت
app.get("/", async (req, res) => {
    if (isWhatsappConnected) {
        res.json({
            message: "🤖 WhatsApp Bot is running and connected! 🎉",
            status: "✅ Connected"
        });
    } else {
        res.json({
            message: "البوت غير متصل. يرجى ربطه بحساب واتساب.",
            status: "Waiting for connection",
            endpoints: {
                linkPhone: "/link-with-phone (POST)"
            }
        });
    }
});

// Route جديد لطلب ربط رقم الهاتف
app.post("/link-with-phone", async (req, res) => {
    const { phone } = req.body;
    if (!phone) {
        return res.status(400).json({ error: "رقم الهاتف مطلوب" });
    }

    try {
        connectingPhoneNumber = phone;
        console.log(`📡 تم استلام طلب ربط لرقم: ${phone}`);
        await startBot();
        
        return res.json({ message: "تم إرسال طلب الربط. يرجى تأكيد الاتصال على هاتفك." });
    } catch (e) {
        console.error("❌ فشل طلب الربط:", e.message);
        return res.status(500).json({ error: "فشل طلب الربط" });
    }
});

// Route لاستقبال الطلبات من Easy Order
app.all("/webhook", async (req, res) => {
    console.log("\n" + "🔥".repeat(50));
    console.log("📩 WEBHOOK HIT! استلمنا request من Easy Order:");
    console.log("التاريخ والوقت:", new Date().toISOString());

    if (!isWhatsappConnected) {
        console.log("❌ البوت غير متصل بواتساب، لن يتم إرسال الرسالة.");
        return res.status(503).json({
            error: "WhatsApp bot is not connected.",
            message: "سيتم إرسال الطلب تلقائياً عند استعادة الاتصال."
        });
    }

    try {
        const data = req.body;
        const customerName = data.full_name || data.customer_name || "عميلنا الكريم";
        const customerPhone = data.phone || data.customer_phone || null;
        const total = data.total_cost || data.total || data.totalAmount || "سيتم تحديده";
        const address = data.address || "غير محدد";
        const items = data.cart_items || data.items || [];
        
        if (!customerPhone) {
            console.log("❌ لم يتم العثور على رقم هاتف العميل");
            return res.json({ error: "مفيش رقم عميل في الأوردر" });
        }

        let itemsList = "";
        if (items && Array.isArray(items)) {
            itemsList = items.map((item, index) => {
                const name = item.product ? item.product.name : item.name;
                const qty = item.quantity || item.qty || 1;
                return `- ${name}: ${qty} عدد القطع`;
            }).join("\n");
        }
        
        let message = `مرحباً ${customerName} 🌟\n` +
                      `شكرًا لاختيارك اوتو سيرفس ! يسعدنا إبلاغك بأنه تم استلام طلبك بنجاح.\n\n` +
                      `🛍️ تفاصيل الطلب: ${itemsList}\n\n` +
                      `💰 الإجمالي: ${total} ج.م\n` +
                      `📍 العنوان: ${address}\n\n` +
                      `للبدء في تجهيز طلبك وشحنه، يُرجى تأكيد الطلب بالضغط على "تم" أو إرسال كلمة "موافق" ✅\n\n` +
                      `📦 نود التنويه أن المعاينة غير متاحة حاليًا وقت الاستلام.\n` +
                      `لكن يمكنك الاستفسار عن أي تفاصيل قبل الشحن، وسنكون سعداء بالرد عليك.`;

        let formattedNumber = customerPhone.toString().trim().replace(/[\s\-\(\)]/g, '');
        if (formattedNumber.startsWith('0')) {
            formattedNumber = '20' + formattedNumber.substring(1);
        } else if (!formattedNumber.startsWith('20')) {
            formattedNumber = '20' + formattedNumber;
        }
        formattedNumber += '@s.whatsapp.net';
        
        console.log(`📞 الرقم المنسق: ${formattedNumber}`);
        console.log("📤 محاولة إرسال الرسالة...");
        await sock.sendMessage(formattedNumber, { text: message });

        console.log(`✅ تم إرسال الطلب للعميل بنجاح على ${formattedNumber}`);
        
        res.json({ 
            success: true, 
            message: "تم إرسال الرسالة بنجاح"
        });

    } catch (err) {
        console.error("❌ خطأ في معالجة الطلب:", err);
        res.status(500).json({ 
            error: "فشل في معالجة الطلب",
            details: err.message
        });
    }
});

const PORT = process.env.PORT;
const HOST = '0.0.0.0'; 
    
app.listen(PORT, HOST, () => {
    console.log(`🚀 Webhook server شغال على http://${HOST}:${PORT}`);
    console.log(`🌐 Public URL: https://${process.env.RENDER_EXTERNAL_HOSTNAME}`);
});

startBot().catch(err => {
    console.error("❌ خطأ في بدء البوت:", err);
});