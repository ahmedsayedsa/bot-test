const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const makeWASocket = require("@whiskeysockets/baileys").default;
const { useMultiFileAuthState, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode");

let isWhatsappConnected = false;
let qrCodeData = null;

async function startBot() {
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
        console.log(`🔗 حالة الاتصال: ${connection}`);

        if (qr) {
            qrCodeData = await qrcode.toDataURL(qr);
            console.log('📡 تم استلام QR code، جاهز للعرض.');
        }

        if (connection === 'close') {
            console.log('❌ الاتصال مقطوع، محاولة إعادة الاتصال...');
            isWhatsappConnected = false;
            // تأخير 5 ثوانٍ قبل إعادة التشغيل لمنع خطأ EADDRINUSE
            setTimeout(() => startBot(), 5000); 
        } else if (connection === 'open') {
            console.log('✅ البوت متصل بنجاح!');
            isWhatsappConnected = true;
            qrCodeData = null;
        }
    });

    const app = express();
    app.use(bodyParser.json({ limit: '50mb' }));

    // Route الرئيسي لعرض الـ QR code أو رسالة التأكيد
    app.get("/", (req, res) => {
        if (!isWhatsappConnected && qrCodeData) {
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
                status: "✅ Connected"
            });
        }
    });

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

    sock.ev.on("messages.upsert", async (m) => {
        if (!m.messages || m.messages.length === 0) return;

        const msg = m.messages[0];
        if (!msg.key.fromMe && msg.message && msg.message.conversation) {
            const text = msg.message.conversation.trim().toLowerCase();
            console.log(`📥 رسالة جديدة من ${msg.key.remoteJid}: ${text}`);

            if (text === "تم" || text === "موافق") {
                const response = `✅ تم تأكيد طلبك، وسنبدأ في تجهيز شحنتك قريبًا!`;
                await sock.sendMessage(msg.key.remoteJid, { text: response });
                console.log("📤 رد على العميل بتأكيد الطلب.");
            }
        }
   });