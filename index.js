// استيراد المكتبات المطلوبة
const express = require("express"); // إضافة هذا السطر المفقود!
const bodyParser = require("body-parser");
const fs = require("fs");
const crypto = require("crypto");

// إضافة crypto polyfill للـ global scope
global.crypto = crypto;
if (crypto.webcrypto) {
    global.crypto.webcrypto = crypto.webcrypto;
}

const makeWASocket = require("@whiskeysockets/baileys").default;
const { useMultiFileAuthState, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode");

let isWhatsappConnected = false;
let qrCodeData = null;
let sock = null;

async function startBot() {
    try {
        console.log("🚀 بدء تشغيل البوت...");
        
        const { state, saveCreds } = await useMultiFileAuthState("auth_info");
        const { version } = await fetchLatestBaileysVersion();
        
        sock = makeWASocket({
            auth: state,
            version,
            printQRInTerminal: false,
            browser: ["WhatsApp Bot", "Chrome", "4.0.0"],
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 0,
            keepAliveIntervalMs: 10000,
            markOnlineOnConnect: false,
            generateHighQualityLinkPreview: false,
            syncFullHistory: false
            // إزالة logger تماماً
        });

        sock.ev.on("creds.update", saveCreds);

        sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect, qr } = update;
            console.log(`🔗 حالة الاتصال: ${connection}`);

            if (qr) {
                try {
                    qrCodeData = await qrcode.toDataURL(qr);
                    console.log('📡 تم إنشاء QR code جديد');
                    
                    // حفظ QR في ملف للوصول إليه لاحقاً
                    fs.writeFileSync('qr.txt', qr);
                } catch (qrError) {
                    console.error('❌ خطأ في إنشاء QR:', qrError);
                }
            }

            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
                console.log('❌ الاتصال مقطوع:', lastDisconnect?.error, 'إعادة الاتصال:', shouldReconnect);
                
                isWhatsappConnected = false;
                
                if (shouldReconnect) {
                    setTimeout(() => startBot(), 10000);
                } else {
                    console.log('❌ البوت محتاج تسجيل دخول جديد');
                    try {
                        if (fs.existsSync("auth_info")) {
                            fs.rmSync("auth_info", { recursive: true, force: true });
                        }
                    } catch (cleanupError) {
                        console.error('❌ خطأ في حذف auth_info:', cleanupError);
                    }
                    setTimeout(() => startBot(), 5000);
                }
            } else if (connection === 'open') {
                console.log('✅ البوت متصل بواتساب بنجاح!');
                isWhatsappConnected = true;
                qrCodeData = null;
                
                // حذف ملف QR بعد الاتصال
                try {
                    if (fs.existsSync('qr.txt')) {
                        fs.unlinkSync('qr.txt');
                    }
                } catch (deleteError) {
                    console.error('❌ خطأ في حذف QR file:', deleteError);
                }
            } else if (connection === 'connecting') {
                console.log('🔄 جاري الاتصال بواتساب...');
            }
        });

        // التعامل مع الرسائل الواردة
        sock.ev.on("messages.upsert", async (m) => {
            try {
                const message = m.messages[0];
                if (!message.message || message.key.fromMe) return;
                
                const text = message.message.conversation || 
                           message.message.extendedTextMessage?.text || "";
                
                console.log(`📨 رسالة واردة من ${message.key.remoteJid}: ${text}`);
                
                if (text.toLowerCase().includes("موافق") || text.toLowerCase().includes("تم")) {
                    await sock.sendMessage(message.key.remoteJid, { 
                        text: "✅ تم تأكيد طلبك بنجاح! سيتم التحضير والتوصيل قريباً. شكراً لثقتك 🙏" 
                    });
                    console.log("✅ تم تأكيد الطلب");
                } else if (text.toLowerCase().includes("الغاء") || text.toLowerCase().includes("إلغاء")) {
                    await sock.sendMessage(message.key.remoteJid, { 
                        text: "❌ تم إلغاء طلبك. نأسف لعدم تمكننا من خدمتك هذه المرة 😔" 
                    });
                    console.log("❌ تم إلغاء الطلب");
                }
            } catch (msgError) {
                console.error('❌ خطأ في معالجة الرسالة:', msgError);
            }
        });

    } catch (error) {
        console.error('❌ خطأ في بدء البوت:', error);
        setTimeout(() => startBot(), 15000);
    }
}

// إعداد Express
const app = express();

// إضافة middleware للأمان والتعامل مع الطلبات
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// إضافة CORS headers
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
});

// Middleware لتسجيل جميع الطلبات
app.use((req, res, next) => {
    console.log(`📡 ${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// Route الرئيسي
app.get("/", (req, res) => {
    try {
        if (!isWhatsappConnected && qrCodeData) {
            const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>WhatsApp Bot - QR Code</title>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <style>
                    body { 
                        font-family: Arial, sans-serif; 
                        display: flex; 
                        flex-direction: column; 
                        align-items: center; 
                        justify-content: center; 
                        min-height: 100vh; 
                        margin: 0; 
                        background: #f0f0f0; 
                        text-align: center;
                        padding: 20px;
                        box-sizing: border-box;
                    }
                    .container { 
                        background: white; 
                        padding: 30px; 
                        border-radius: 10px; 
                        box-shadow: 0 4px 6px rgba(0,0,0,0.1); 
                        max-width: 400px;
                        width: 100%;
                    }
                    img { 
                        border: 2px solid #25D366; 
                        border-radius: 10px; 
                        margin: 20px 0; 
                        max-width: 100%;
                        height: auto;
                    }
                    .status { 
                        color: #25D366; 
                        font-weight: bold; 
                    }
                </style>
                <script>
                    // تحديث الصفحة كل 5 ثوان لفحص الاتصال
                    setTimeout(() => window.location.reload(), 5000);
                </script>
            </head>
            <body>
                <div class="container">
                    <h1>🤖 WhatsApp Bot</h1>
                    <h2>امسح الرمز باستخدام واتساب</h2>
                    <img src="${qrCodeData}" alt="QR Code">
                    <p class="status">🔄 في انتظار المسح...</p>
                    <small>ستتم إعادة تحميل الصفحة تلقائياً</small>
                </div>
            </body>
            </html>`;
            res.send(html);
        } else if (isWhatsappConnected) {
            const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>WhatsApp Bot - Connected</title>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <style>
                    body { 
                        font-family: Arial, sans-serif; 
                        display: flex; 
                        flex-direction: column; 
                        align-items: center; 
                        justify-content: center; 
                        min-height: 100vh; 
                        margin: 0; 
                        background: #25D366; 
                        color: white; 
                        text-align: center;
                        padding: 20px;
                        box-sizing: border-box;
                    }
                </style>
            </head>
            <body>
                <h1>✅ البوت متصل بنجاح!</h1>
                <p>🤖 WhatsApp Bot is running and ready to receive orders</p>
                <p>📱 جاهز لاستقبال الطلبات من Easy Order</p>
            </body>
            </html>`;
            res.send(html);
        } else {
            res.json({
                status: "🔄 Starting...",
                connected: false,
                message: "البوت يحاول الاتصال بواتساب..."
            });
        }
    } catch (error) {
        console.error('❌ خطأ في الصفحة الرئيسية:', error);
        res.status(500).json({ error: "خطأ في تحميل الصفحة" });
    }
});

// Route للحالة
app.get("/status", (req, res) => {
    res.json({
        connected: isWhatsappConnected,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        hasQR: !!qrCodeData,
        memory: process.memoryUsage()
    });
});

// Webhook لاستقبال طلبات Easy Order
app.post("/webhook", async (req, res) => {
    console.log("\n" + "🔥".repeat(50));
    console.log("📩 WEBHOOK HIT! استلمنا request من Easy Order:");
    console.log("التاريخ والوقت:", new Date().toISOString());
    console.log("البيانات المستلمة:", JSON.stringify(req.body, null, 2));
    console.log("🔥".repeat(50) + "\n");

    if (!isWhatsappConnected) {
        console.log("❌ البوت غير متصل بواتساب");
        return res.status(503).json({
            error: "WhatsApp bot is not connected",
            message: "البوت غير متصل بواتساب حالياً"
        });
    }

    try {
        const data = req.body;
        
        // استخراج البيانات بطرق مختلفة
        const customerName = data.full_name || data.customer_name || data.name || "عميلنا الكريم";
        const customerPhone = data.phone || data.customer_phone || data.mobile || null;
        const total = data.total_cost || data.total || data.totalAmount || data.amount || "سيتم تحديده";
        const address = data.address || data.shipping_address || "غير محدد";
        const items = data.cart_items || data.items || data.products || [];
        
        console.log(`👤 العميل: ${customerName}`);
        console.log(`📱 الهاتف: ${customerPhone}`);
        console.log(`💰 المجموع: ${total}`);
        console.log(`📍 العنوان: ${address}`);
        console.log(`🛍️ العناصر:`, items);
        
        if (!customerPhone) {
            console.log("❌ لم يتم العثور على رقم هاتف العميل");
            return res.status(400).json({ 
                error: "مفيش رقم عميل في الأوردر",
                receivedData: data
            });
        }

        // تنسيق قائمة المنتجات
        let itemsList = "";
        if (items && Array.isArray(items) && items.length > 0) {
            itemsList = items.map((item, index) => {
                const name = item.product?.name || item.name || item.title || `منتج ${index + 1}`;
                const qty = item.quantity || item.qty || 1;
                const price = item.price || item.unit_price || '';
                return `- ${name}: ${qty} قطعة${price ? ` (${price} ج.م)` : ''}`;
            }).join("\n");
        }
        
        // صياغة الرسالة
        let message = `مرحباً ${customerName} 🌟\n\n` +
                      `شكرًا لاختيارك اوتو سيرفس! يسعدنا إبلاغك بأنه تم استلام طلبك بنجاح.\n\n`;
        
        if (itemsList) {
            message += `🛍️ تفاصيل الطلب:\n${itemsList}\n\n`;
        }
        
        message += `💰 الإجمالي: ${total} ج.م\n` +
                   `📍 العنوان: ${address}\n\n` +
                   `للبدء في تجهيز طلبك وشحنه، يُرجى تأكيد الطلب بإرسال كلمة "موافق" أو "تم" ✅\n\n` +
                   `📦 المعاينة غير متاحة وقت الاستلام، لكن يمكنك الاستفسار عن أي تفاصيل قبل الشحن.`;

        // تنسيق رقم الهاتف
        let formattedNumber = customerPhone.toString().trim().replace(/[\s\-\(\)]/g, '');
        
        if (formattedNumber.startsWith('0')) {
            formattedNumber = '20' + formattedNumber.substring(1);
        } else if (!formattedNumber.startsWith('20')) {
            formattedNumber = '20' + formattedNumber;
        }
        
        formattedNumber += '@s.whatsapp.net';
        
        console.log(`📞 الرقم المنسق: ${formattedNumber}`);
        console.log("📤 محاولة إرسال الرسالة...");

        // إرسال الرسالة مع معالجة الأخطاء
        await sock.sendMessage(formattedNumber, { text: message });

        console.log(`✅ تم إرسال الطلب للعميل بنجاح على ${formattedNumber}`);
        
        res.json({ 
            success: true, 
            message: "تم إرسال الرسالة بنجاح",
            sentTo: customerPhone,
            customerName: customerName,
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        console.error("❌ خطأ في معالجة الطلب:", err);
        res.status(500).json({ 
            error: "فشل في معالجة الطلب",
            details: err.message,
            receivedData: req.body
        });
    }
});

// Route لاختبار إرسال رسالة
app.post("/test-send", async (req, res) => {
    if (!isWhatsappConnected) {
        return res.status(503).json({ error: "البوت غير متصل" });
    }
    
    try {
        const { phone, message } = req.body;
        
        if (!phone || !message) {
            return res.status(400).json({ error: "مطلوب رقم هاتف ورسالة" });
        }
        
        let formattedNumber = phone.toString().replace(/^0/, "20") + "@s.whatsapp.net";
        await sock.sendMessage(formattedNumber, { text: message });
        
        res.json({ 
            success: true, 
            sentTo: formattedNumber,
            message: "تم إرسال الرسالة بنجاح"
        });
    } catch (error) {
        console.error('❌ خطأ في إرسال الرسالة التجريبية:', error);
        res.status(500).json({ error: error.message });
    }
});

// Health check لـ Render
app.get("/health", (req, res) => {
    res.json({ 
        status: "OK", 
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        connected: isWhatsappConnected,
        timestamp: new Date().toISOString()
    });
});

// مسار لإعادة تشغيل البوت
app.post("/restart", (req, res) => {
    try {
        console.log("🔄 إعادة تشغيل البوت...");
        isWhatsappConnected = false;
        qrCodeData = null;
        
        if (sock) {
            sock.end();
        }
        
        setTimeout(() => {
            startBot();
        }, 2000);
        
        res.json({ success: true, message: "تم إعادة تشغيل البوت" });
    } catch (error) {
        console.error('❌ خطأ في إعادة التشغيل:', error);
        res.status(500).json({ error: error.message });
    }
});

// Error handlers
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    // لا نقوم بإنهاء العملية، فقط نسجل الخطأ
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

// معالج إشارة إنهاء العملية
process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, closing gracefully...');
    if (sock) {
        sock.end();
    }
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 SIGINT received, closing gracefully...');
    if (sock) {
        sock.end();
    }
    process.exit(0);
});

// بدء الخادم
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`🚀 Server شغال على http://${HOST}:${PORT}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📊 Memory Usage:`, process.memoryUsage());
    
    // بدء البوت بعد تشغيل الخادم
    setTimeout(() => {
        startBot();
    }, 2000);
});