// استيراد المكتبات المطلوبة
const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const crypto = require("crypto");
const axios = require("axios"); // لإرسال طلبات HTTP إلى Easy Order

// إضافة crypto polyfill للـ global scope
global.crypto = crypto;
if (crypto.webcrypto) {
    global.crypto.webcrypto = crypto.webcrypto;
}

const makeWASocket = require("@whiskeysockets/baileys").default;
const { useMultiFileAuthState, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode");

// دالة لتنظيف HTML وتحويله لنص عادي
function stripHtml(html) {
    if (!html || typeof html !== 'string') return '';
    
    return html
        .replace(/<[^>]*>/g, '') // إزالة جميع tags
        .replace(/&nbsp;/g, ' ') // إزالة &nbsp;
        .replace(/&amp;/g, '&')  // إزالة &amp;
        .replace(/&lt;/g, '<')   // إزالة &lt;
        .replace(/&gt;/g, '>')   // إزالة &gt;
        .replace(/&quot;/g, '"') // إزالة &quot;
        .replace(/&#39;/g, "'")  // إزالة &#39;
        .replace(/\s+/g, ' ')    // تنظيف المسافات المتعددة
        .trim();                 // إزالة المسافات من البداية والنهاية
}

// دالة لقطع النص الطويل
function truncateText(text, maxLength = 100) {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

let isWhatsappConnected = false;
let qrCodeData = null;
let sock = null;

// متغيرات Easy Order
const EASY_ORDER_API_URL = process.env.EASY_ORDER_API_URL || "https://your-easyorder-domain.com/api";
const EASY_ORDER_API_KEY = process.env.EASY_ORDER_API_KEY || "your-api-key";

// تخزين مؤقت للطلبات
const pendingOrders = new Map();

// دالة لتنسيق الوقت المحلي
function getCurrentTime() {
    const now = new Date();
    // تحويل للتوقيت المحلي (GMT+2 مصر)
    const localTime = new Date(now.getTime() + (2 * 60 * 60 * 1000));
    return localTime.toLocaleString('ar-EG', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

async function startBot() {
    try {
        console.log("🚀 بدء تشغيل البوت...");
        
        const { state, saveCreds } = await useMultiFileAuthState("auth_info");
        const { version } = await fetchLatestBaileysVersion();
        
        sock = makeWASocket({
            auth: state,
            version,
            printQRInTerminal: false,
            browser: ["Auto Service Bot", "Chrome", "4.0.0"],
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 0,
            keepAliveIntervalMs: 10000,
            markOnlineOnConnect: false,
            generateHighQualityLinkPreview: false,
            syncFullHistory: false
        });

        sock.ev.on("creds.update", saveCreds);

        sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect, qr } = update;
            console.log(`🔗 حالة الاتصال: ${connection}`);

            if (qr) {
                try {
                    qrCodeData = await qrcode.toDataURL(qr);
                    console.log('📡 تم إنشاء QR code جديد');
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

        // التعامل مع الرسائل الواردة والأزرار
        sock.ev.on("messages.upsert", async (m) => {
            try {
                const message = m.messages[0];
                if (!message.message || message.key.fromMe) return;
                
                const userPhone = message.key.remoteJid.replace('@s.whatsapp.net', '');
                
                // التعامل مع ردود الأزرار
                if (message.message.buttonsResponseMessage) {
                    const buttonId = message.message.buttonsResponseMessage.selectedButtonId;
                    const orderData = pendingOrders.get(userPhone);
                    
                    if (orderData && buttonId) {
                        await handleButtonResponse(buttonId, userPhone, orderData, message.key.remoteJid);
                        return;
                    }
                }
                
                // التعامل مع الردود النصية
                const text = message.message.conversation || 
                           message.message.extendedTextMessage?.text || "";
                
                console.log(`📨 رسالة واردة من ${message.key.remoteJid}: ${text}`);
                
                const orderData = pendingOrders.get(userPhone);
                if (orderData) {
                    if (text.toLowerCase().includes("موافق") || text.toLowerCase().includes("تم") || text.toLowerCase().includes("تأكيد") || text.toLowerCase().includes("نعم")) {
                        await handleOrderConfirmation(userPhone, orderData, message.key.remoteJid, true);
                    } else if (text.toLowerCase().includes("الغاء") || text.toLowerCase().includes("إلغاء") || text.toLowerCase().includes("رفض") || text.toLowerCase().includes("لا")) {
                        await handleOrderConfirmation(userPhone, orderData, message.key.remoteJid, false);
                    }
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

// دالة للتعامل مع ردود الأزرار
async function handleButtonResponse(buttonId, userPhone, orderData, chatId) {
    try {
        console.log(`🔘 Button clicked: ${buttonId} from ${userPhone}`);
        
        if (buttonId === 'confirm_order') {
            await handleOrderConfirmation(userPhone, orderData, chatId, true);
        } else if (buttonId === 'cancel_order') {
            await handleOrderConfirmation(userPhone, orderData, chatId, false);
        }
    } catch (error) {
        console.error('❌ خطأ في معالجة رد الزر:', error);
    }
}

// دالة لمعالجة تأكيد أو إلغاء الطلب - المحدثة
async function handleOrderConfirmation(userPhone, orderData, chatId, isConfirmed) {
    try {
        let responseMessage = "";
        let orderStatus = "";
        
        if (isConfirmed) {
            responseMessage = `✅ *تم تأكيد طلبك بنجاح يا ${orderData.customerName}!*

🎉 *مبروك!* طلبك تم استلامه وتأكيده بنجاح

━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 *تفاصيل الطلب المؤكد:*
🆔 رقم الطلب: *#${orderData.orderId.toString().slice(-6)}*
💰 الإجمالي: *${orderData.total} جنيه*
⏰ تاريخ التأكيد: *${getCurrentTime()}*

━━━━━━━━━━━━━━━━━━━━━━━━━━
🔄 *الخطوات التالية:*
• ⏳ سيتم تجهيز طلبك خلال 24-48 ساعة
• 📦 سيتم تعبئة المنتجات بعناية فائقة
• 🚚 سيتم شحن الطلب عبر شركة الشحن المختارة
• 📱 سنرسل لك رقم الشحنة فور الإرسال

━━━━━━━━━━━━━━━━━━━━━━━━━━
📞 *للتواصل والاستفسارات:*
• واتساب: اضغط هنا للمحادثة المباشرة
• الهاتف: متاح 24/7 لخدمتك

━━━━━━━━━━━━━━━━━━━━━━━━━━
🌟 *اوتو سيرفس - Auto Service*
*"خدمة احترافية.. جودة مضمونة.. ثقة متبادلة"*

شكراً لثقتك الغالية فينا! 🙏❤️`;
            orderStatus = "confirmed";
        } else {
            responseMessage = `❌ *تم إلغاء طلبك يا ${orderData.customerName}*

━━━━━━━━━━━━━━━━━━━━━━━━━━
💔 نأسف لعدم تمكننا من خدمتك هذه المرة

📋 *تفاصيل الطلب الملغي:*
🆔 رقم الطلب: *#${orderData.orderId.toString().slice(-6)}*
💰 كان المبلغ: *${orderData.total} جنيه*
⏰ تاريخ الإلغاء: *${getCurrentTime()}*

━━━━━━━━━━━━━━━━━━━━━━━━━━
🔄 *يمكنك دائماً:*
• 🛒 تقديم طلب جديد في أي وقت
• 📞 الاتصال بنا للاستفسار عن المنتجات
• 🌐 زيارة موقعنا لتصفح الكتالوج كاملاً

━━━━━━━━━━━━━━━━━━━━━━━━━━
📞 *نحن هنا لخدمتك:*
• واتساب: متاح 24/7
• خدمة العملاء: جاهزون لمساعدتك

━━━━━━━━━━━━━━━━━━━━━━━━━━
🌟 *اوتو سيرفس - Auto Service*
*"نتطلع لخدمتك قريباً"*

نشكرك على تواصلك معنا 🙏`;
            orderStatus = "cancelled";
        }
        
        // إرسال الرسالة للعميل
        await sock.sendMessage(chatId, { text: responseMessage });
        
        // تحديث حالة الطلب في Easy Order
        await updateOrderStatusInEasyOrder(orderData.orderId, orderStatus, orderData);
        
        // حذف الطلب من الذاكرة المؤقتة
        pendingOrders.delete(userPhone);
        
        console.log(`✅ ${isConfirmed ? 'تم تأكيد' : 'تم إلغاء'} الطلب ${orderData.orderId}`);
        
    } catch (error) {
        console.error('❌ خطأ في معالجة تأكيد الطلب:', error);
        
        // إرسال رسالة خطأ
        await sock.sendMessage(chatId, { 
            text: "❌ حدث خطأ تقني مؤقت في معالجة طلبك.\n\nيرجى المحاولة مرة أخرى أو التواصل معنا مباشرة.\n\n📞 نحن معك خطوة بخطوة!" 
        });
    }
}

// دالة لتحديث حالة الطلب في Easy Order
async function updateOrderStatusInEasyOrder(orderId, status, orderData) {
    try {
        const updateData = {
            order_id: orderId,
            status: status,
            updated_at: new Date().toISOString(),
            notes: `تم ${status === 'confirmed' ? 'تأكيد' : 'إلغاء'} الطلب عبر WhatsApp Bot في ${getCurrentTime()}`
        };
        
        console.log(`📤 تحديث حالة الطلب في Easy Order: ${orderId} -> ${status}`);
        
        // إرسال طلب التحديث إلى Easy Order API
        const response = await axios.post(
            `${EASY_ORDER_API_URL}/orders/${orderId}/update-status`,
            updateData,
            {
                headers: {
                    'Authorization': `Bearer ${EASY_ORDER_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            }
        );
        
        if (response.status === 200) {
            console.log(`✅ تم تحديث الطلب ${orderId} في Easy Order بنجاح`);
        } else {
            console.log(`⚠️ استجابة غير متوقعة من Easy Order: ${response.status}`);
        }
        
    } catch (error) {
        console.error(`❌ خطأ في تحديث Easy Order للطلب ${orderId}:`, error.message);
    }
}

// إعداد Express
const app = express();

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
                <title>Auto Service WhatsApp Bot - QR Code</title>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <style>
                    body { 
                        font-family: 'Cairo', Arial, sans-serif; 
                        display: flex; 
                        flex-direction: column; 
                        align-items: center; 
                        justify-content: center; 
                        min-height: 100vh; 
                        margin: 0; 
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        text-align: center;
                        padding: 20px;
                        box-sizing: border-box;
                    }
                    .container { 
                        background: rgba(255,255,255,0.95); 
                        padding: 40px; 
                        border-radius: 20px; 
                        box-shadow: 0 20px 40px rgba(0,0,0,0.1); 
                        max-width: 450px;
                        width: 100%;
                        animation: fadeIn 0.6s ease-in;
                        backdrop-filter: blur(10px);
                    }
                    @keyframes fadeIn {
                        from { opacity: 0; transform: translateY(30px); }
                        to { opacity: 1; transform: translateY(0); }
                    }
                    .logo { 
                        font-size: 2.5em; 
                        color: #667eea; 
                        margin-bottom: 10px;
                        font-weight: bold;
                    }
                    img { 
                        border: 4px solid #667eea; 
                        border-radius: 20px; 
                        margin: 25px 0; 
                        max-width: 100%;
                        height: auto;
                        box-shadow: 0 10px 30px rgba(0,0,0,0.15);
                    }
                    .status { 
                        color: #667eea; 
                        font-weight: bold; 
                        font-size: 18px;
                        margin: 20px 0;
                    }
                    .brand {
                        color: #764ba2;
                        font-size: 1.8em;
                        font-weight: bold;
                        margin-bottom: 5px;
                    }
                    .tagline {
                        color: #666;
                        font-size: 14px;
                        margin-bottom: 20px;
                    }
                    .loader {
                        border: 4px solid #f3f3f3;
                        border-top: 4px solid #667eea;
                        border-radius: 50%;
                        width: 40px;
                        height: 40px;
                        animation: spin 1.5s linear infinite;
                        margin: 20px auto;
                    }
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                    .instructions {
                        background: #f8f9ff;
                        padding: 20px;
                        border-radius: 15px;
                        margin: 20px 0;
                        color: #555;
                        font-size: 14px;
                    }
                </style>
                <script>
                    setTimeout(() => window.location.reload(), 8000);
                </script>
            </head>
            <body>
                <div class="container">
                    <div class="logo">🤖</div>
                    <div class="brand">اوتو سيرفس</div>
                    <div class="tagline">Auto Service WhatsApp Bot</div>
                    
                    <div class="instructions">
                        <h3>خطوات التفعيل:</h3>
                        <p>1️⃣ افتح واتساب على هاتفك</p>
                        <p>2️⃣ اضغط على النقاط الثلاث ← الأجهزة المرتبطة</p>
                        <p>3️⃣ اضغط "ربط جهاز" وامسح الكود أدناه</p>
                    </div>
                    
                    <img src="${qrCodeData}" alt="QR Code">
                    <div class="loader"></div>
                    <p class="status">🔄 في انتظار المسح الضوئي...</p>
                    <small style="color: #888;">سيتم تحديث الصفحة تلقائياً كل 8 ثوان</small>
                </div>
            </body>
            </html>`;
            res.send(html);
        } else if (isWhatsappConnected) {
            const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Auto Service Bot - Connected</title>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <style>
                    body { 
                        font-family: 'Cairo', Arial, sans-serif; 
                        display: flex; 
                        flex-direction: column; 
                        align-items: center; 
                        justify-content: center; 
                        min-height: 100vh; 
                        margin: 0; 
                        background: linear-gradient(135deg, #2ecc71 0%, #27ae60 100%);
                        color: white; 
                        text-align: center;
                        padding: 20px;
                        box-sizing: border-box;
                    }
                    .status-card {
                        background: rgba(255,255,255,0.15);
                        padding: 40px;
                        border-radius: 20px;
                        backdrop-filter: blur(15px);
                        box-shadow: 0 20px 40px rgba(0,0,0,0.2);
                        animation: pulse 3s infinite;
                        border: 1px solid rgba(255,255,255,0.2);
                    }
                    @keyframes pulse {
                        0% { transform: scale(1); }
                        50% { transform: scale(1.02); }
                        100% { transform: scale(1); }
                    }
                    .success-icon {
                        font-size: 4em;
                        margin-bottom: 20px;
                        animation: bounce 2s infinite;
                    }
                    @keyframes bounce {
                        0%, 20%, 50%, 80%, 100% {
                            transform: translateY(0);
                        }
                        40% {
                            transform: translateY(-10px);
                        }
                        60% {
                            transform: translateY(-5px);
                        }
                    }
                    .brand-title {
                        font-size: 2.5em;
                        font-weight: bold;
                        margin-bottom: 10px;
                    }
                    .stats {
                        display: grid;
                        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
                        gap: 20px;
                        margin: 30px 0;
                        max-width: 600px;
                    }
                    .stat-item {
                        background: rgba(255,255,255,0.2);
                        padding: 20px;
                        border-radius: 15px;
                        border: 1px solid rgba(255,255,255,0.3);
                    }
                    .stat-number {
                        font-size: 2em;
                        font-weight: bold;
                        margin-bottom: 5px;
                    }
                    .features {
                        margin: 30px 0;
                        text-align: left;
                        background: rgba(255,255,255,0.1);
                        padding: 20px;
                        border-radius: 15px;
                    }
                    .feature-item {
                        margin: 10px 0;
                        padding: 10px;
                        border-left: 3px solid rgba(255,255,255,0.5);
                        padding-left: 15px;
                    }
                </style>
            </head>
            <body>
                <div class="status-card">
                    <div class="success-icon">✅</div>
                    <div class="brand-title">اوتو سيرفس</div>
                    <h2>البوت متصل بنجاح!</h2>
                    <p style="font-size: 1.2em;">🤖 Auto Service Bot is Live & Ready</p>
                    
                    <div class="stats">
                        <div class="stat-item">
                            <div class="stat-number">${pendingOrders.size}</div>
                            <div>📊 الطلبات المعلقة</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-number">${Math.floor(process.uptime() / 60)}</div>
                            <div>⏱️ دقائق التشغيل</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-number">${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB</div>
                            <div>💾 استخدام الذاكرة</div>
                        </div>
                    </div>
                    
                    <div class="features">
                        <h3>🚀 الميزات النشطة:</h3>
                        <div class="feature-item">📱 استقبال طلبات Easy Order</div>
                        <div class="feature-item">✅ تأكيد الطلبات التلقائي</div>
                        <div class="feature-item">🔔 إشعارات فورية للعملاء</div>
                        <div class="feature-item">📊 مراقبة الأداء المباشر</div>
                    </div>
                    
                    <p style="font-size: 0.9em; opacity: 0.8; margin-top: 20px;">
                        "خدمة احترافية.. جودة مضمونة.. ثقة متبادلة"
                    </p>
                </div>
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
        memory: process.memoryUsage(),
        pendingOrders: pendingOrders.size,
        activeOrders: Array.from(pendingOrders.keys())
    });
});

// Webhook لاستقبال طلبات Easy Order (محدث مع رسالة أفضل)
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
        
        // استخراج البيانات من Easy Order
        const orderId = data.id || data.order_id || Date.now().toString();
        const customerName = data.full_name || data.customer_name || data.name || 
                           data.customer?.name || data.user?.name || "عميلنا الكريم";
        const customerPhone = data.phone || data.customer_phone || data.mobile || 
                             data.customer?.phone || data.user?.phone || null;
        const total = data.total_cost || data.total || data.totalAmount || data.amount || 
                     data.grand_total || "سيتم تحديده";
        const address = data.address || data.shipping_address || data.delivery_address || 
                       data.customer?.address || "غير محدد";
        
        // معالجة العناصر - يمكن أن تكون منتج واحد أو قائمة منتجات
        let items = [];
        if (data.cart_items && Array.isArray(data.cart_items)) {
            items = data.cart_items;
        } else if (data.items && Array.isArray(data.items)) {
            items = data.items;
        } else if (data.products && Array.isArray(data.products)) {
            items = data.products;
        } else if (data.product) {
            // منتج واحد
            items = [data.product];
        } else if (data.name && data.price) {
            // البيانات مباشرة كمنتج واحد
            items = [{
                name: data.name,
                price: data.sale_price || data.price,
                quantity: data.quantity || 1,
                description: data.description
            }];
        }
        
        console.log(`📝 رقم الطلب: ${orderId}`);
        console.log(`👤 العميل: ${customerName}`);
        console.log(`📱 الهاتف: ${customerPhone}`);
        console.log(`💰 المجموع: ${total}`);
        
        if (!customerPhone) {
            console.log("❌ لم يتم العثور على رقم هاتف العميل");
            return res.status(400).json({ 
                error: "مفيش رقم عميل في الأوردر",
                receivedData: data
            });
        }

        // حفظ بيانات الطلب في الذاكرة المؤقتة
        const orderData = {
            orderId: orderId,
            customerName: customerName,
            customerPhone: customerPhone,
            total: total,
            address: address,
            items: items,
            timestamp: new Date().toISOString()
        };

        // تنسيق قائمة المنتجات مع معالجة أفضل للبيانات
        let itemsList = "";
        if (items && Array.isArray(items) && items.length > 0) {
            itemsList = items.map((item, index) => {
                // استخراج اسم المنتج
                const name = item.product?.name || item.name || item.title || `منتج ${index + 1}`;
                
                // استخراج الكمية
                const qty = item.quantity || item.qty || item.pivot?.quantity || 1;
                
                // استخراج السعر (أولوية لسعر التخفيض)
                let price = '';
                if (item.sale_price && item.sale_price > 0) {
                    price = item.sale_price;
                } else if (item.price) {
                    price = item.price;
                } else if (item.unit_price) {
                    price = item.unit_price;
                } else if (item.product?.sale_price && item.product.sale_price > 0) {
                    price = item.product.sale_price;
                } else if (item.product?.price) {
                    price = item.product.price;
                }
                
                // تنسيق السطر مع رموز تعبيرية أجمل
                let line = `🔹 *${name}*`;
                if (qty > 1) {
                    line += ` (${qty} قطعة)`;
                }
                if (price) {
                    line += `\n   💰 ${price} جنيه${qty > 1 ? ' للقطعة الواحدة' : ''}`;
                }
                
                return line;
            }).join("\n\n");
        }
        
        // حساب المجموع إذا لم يكن موجود
        if (total === "سيتم تحديده" && items && items.length > 0) {
            let calculatedTotal = 0;
            items.forEach(item => {
                const qty = item.quantity || item.qty || item.pivot?.quantity || 1;
                const price = item.sale_price || item.price || item.unit_price || 
                            item.product?.sale_price || item.product?.price || 0;
                calculatedTotal += (qty * price);
            });
            if (calculatedTotal > 0) {
                orderData.total = calculatedTotal + " جنيه";
            }
        }
        
        // الرسالة المحدثة والأكثر احترافية
        let message = `🌟 *أهلاً وسهلاً بك ${customerName}*

━━━━━━━━━━━━━━━━━━━━━━━━━━
🎉 *مبروك! تم استلام طلبك بنجاح*

شكراً لاختيارك *اوتو سيرفس* - ثقتك أمانة عندنا! ❤️

━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 *تفاصيل طلبك:*
🆔 رقم الطلب: *#AS${orderId.toString().slice(-6)}*
⏰ وقت الطلب: *${getCurrentTime()}*

`;
        
        if (itemsList) {
            message += `🛍️ *المنتجات المطلوبة:*\n${itemsList}\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        }
        
        message += `💰 *الإجمالي: ${orderData.total}*\n`;
        
        if (address && address !== "غير محدد") {
            message += `📍 *عنوان التوصيل:* ${address}\n`;
        }
        
        message += `
━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ *ملاحظة مهمة جداً:*
• 🚫 *المعاينة غير متاحة وقت الاستلام*
• ✅ يُرجى التأكد من طلبك قبل التأكيد
• 📦 سيتم تعبئة طلبك بعناية فائقة

━━━━━━━━━━━━━━━━━━━━━━━━━━
🔄 *يُرجى تأكيد طلبك للبدء فوراً في:*
• 📦 التحضير والتعبئة المتخصصة
• 🚚 الشحن السريع والآمن
• 📱 إرسال رقم الشحنة للمتابعة

━━━━━━━━━━━━━━━━━━━━━━━━━━
🌟 *اوتو سيرفس - Auto Service*
*"خدمة احترافية.. جودة مضمونة.. ثقة متبادلة"*`;

        // إنشاء الأزرار التفاعلية المحسنة
        const buttons = [
            {
                buttonId: 'confirm_order',
                buttonText: { displayText: '✅ تأكيد الطلب والشحن' },
                type: 1
            },
            {
                buttonId: 'cancel_order', 
                buttonText: { displayText: '❌ إلغاء الطلب' },
                type: 1
            }
        ];

        const buttonMessage = {
            text: message,
            buttons: buttons,
            headerType: 1
        };

        // معالجة رقم الهاتف مع المزيد من التحقق
        let formattedNumber = customerPhone.toString().trim().replace(/[\s\-\(\)\+]/g, '');
        
        // إزالة الأصفار البادئة والتنسيق
        if (formattedNumber.startsWith('00')) {
            formattedNumber = formattedNumber.substring(2);
        } else if (formattedNumber.startsWith('0')) {
            formattedNumber = '20' + formattedNumber.substring(1);
        } else if (!formattedNumber.startsWith('20') && !formattedNumber.startsWith('1')) {
            formattedNumber = '20' + formattedNumber;
        }
        
        // التأكد من أن الرقم يبدأ بـ 20 للأرقام المصرية
        if (!formattedNumber.startsWith('20') && !formattedNumber.startsWith('1')) {
            formattedNumber = '20' + formattedNumber;
        }
        
        formattedNumber += '@s.whatsapp.net';
        
        // حفظ الطلب في الذاكرة المؤقتة
        const phoneKey = customerPhone.toString().replace(/[\s\-\(\)]/g, '').replace(/^0/, '');
        pendingOrders.set(phoneKey, orderData);
        
        console.log(`📞 الرقم المنسق: ${formattedNumber}`);
        console.log("📤 محاولة إرسال الرسالة مع الأزرار...");

        // إرسال الرسالة مع الأزرار
        await sock.sendMessage(formattedNumber, buttonMessage);

        console.log(`✅ تم إرسال الطلب مع الأزرار للعميل بنجاح على ${formattedNumber}`);
        
        // إعداد timeout لحذف الطلب بعد ساعتين إذا لم يتم الرد
        setTimeout(() => {
            if (pendingOrders.has(phoneKey)) {
                console.log(`⏰ انتهت صلاحية الطلب ${orderId} - حذف من الذاكرة`);
                pendingOrders.delete(phoneKey);
            }
        }, 2 * 60 * 60 * 1000); // ساعتان
        
        res.json({ 
            success: true, 
            message: "تم إرسال الرسالة مع الأزرار بنجاح",
            orderId: orderId,
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

// Route جديد لعرض الطلبات المعلقة
app.get("/pending-orders", (req, res) => {
    const orders = Array.from(pendingOrders.entries()).map(([phone, data]) => ({
        phone: phone,
        ...data
    }));
    
    res.json({
        count: pendingOrders.size,
        orders: orders
    });
});

// Route لإلغاء طلب معين (للإدارة)
app.post("/cancel-order/:orderId", async (req, res) => {
    try {
        const orderId = req.params.orderId;
        let orderFound = false;
        let phoneKey = null;
        let orderData = null;

        // البحث عن الطلب
        for (const [phone, data] of pendingOrders.entries()) {
            if (data.orderId === orderId) {
                phoneKey = phone;
                orderData = data;
                orderFound = true;
                break;
            }
        }

        if (!orderFound) {
            return res.status(404).json({ error: "الطلب غير موجود أو تم معالجته بالفعل" });
        }

        // إلغاء الطلب
        await updateOrderStatusInEasyOrder(orderId, 'cancelled', orderData);
        
        // إرسال رسالة إلغاء محسنة للعميل
        const formattedNumber = `20${phoneKey}@s.whatsapp.net`;
        await sock.sendMessage(formattedNumber, {
            text: `❌ *تم إلغاء طلبك من قِبل الإدارة*

━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 *تفاصيل الطلب الملغي:*
🆔 رقم الطلب: *#AS${orderId.toString().slice(-6)}*
👤 العميل: *${orderData.customerName}*
⏰ تاريخ الإلغاء: *${getCurrentTime()}*

━━━━━━━━━━━━━━━━━━━━━━━━━━
💔 نأسف بشدة لهذا الإجراء

🔄 *أسباب محتملة للإلغاء:*
• نفاد المنتج من المخزون
• مشكلة تقنية في النظام  
• تعديل في بيانات الطلب

━━━━━━━━━━━━━━━━━━━━━━━━━━
📞 *للاستفسار والمساعدة:*
• اتصل بنا فوراً للتوضيح
• يمكنك إعادة الطلب في أي وقت

━━━━━━━━━━━━━━━━━━━━━━━━━━
🌟 *اوتو سيرفس - Auto Service*
نعتذر بصدق ونتطلع لخدمتك قريباً 🙏`
        });

        // حذف من الذاكرة
        pendingOrders.delete(phoneKey);

        res.json({ 
            success: true, 
            message: `تم إلغاء الطلب ${orderId} بنجاح`,
            cancelledOrder: orderData
        });

    } catch (error) {
        console.error('❌ خطأ في إلغاء الطلب:', error);
        res.status(500).json({ error: error.message });
    }
});

// Route لاختبار إرسال رسالة مع أزرار
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
        
        // إرسال رسالة عادية أو مع أزرار حسب الطلب
        if (req.body.withButtons) {
            const buttons = [
                { buttonId: 'test_yes', buttonText: { displayText: '✅ نعم' }, type: 1 },
                { buttonId: 'test_no', buttonText: { displayText: '❌ لا' }, type: 1 }
            ];
            
            const buttonMessage = {
                text: message,
                buttons: buttons,
                headerType: 1
            };
            
            await sock.sendMessage(formattedNumber, buttonMessage);
        } else {
            await sock.sendMessage(formattedNumber, { text: message });
        }
        
        res.json({ 
            success: true, 
            sentTo: formattedNumber,
            message: "تم إرسال الرسالة بنجاح",
            withButtons: !!req.body.withButtons
        });
    } catch (error) {
        console.error('❌ خطأ في إرسال الرسالة التجريبية:', error);
        res.status(500).json({ error: error.message });
    }
});

// Health check لـ Google Cloud
app.get("/health", (req, res) => {
    res.json({ 
        status: "OK", 
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        connected: isWhatsappConnected,
        timestamp: new Date().toISOString(),
        pendingOrders: pendingOrders.size,
        service: "Auto Service WhatsApp Bot"
    });
});

// مسار لإعادة تشغيل البوت
app.post("/restart", (req, res) => {
    try {
        console.log("🔄 إعادة تشغيل البوت...");
        isWhatsappConnected = false;
        qrCodeData = null;
        
        // مسح الطلبات المعلقة عند إعادة التشغيل
        pendingOrders.clear();
        
        if (sock) {
            sock.end();
        }
        
        setTimeout(() => {
            startBot();
        }, 2000);
        
        res.json({ success: true, message: "تم إعادة تشغيل البوت بنجاح" });
    } catch (error) {
        console.error('❌ خطأ في إعادة التشغيل:', error);
        res.status(500).json({ error: error.message });
    }
});

// Route جديد للإحصائيات المتقدمة
app.get("/stats", (req, res) => {
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);
    
    const recentOrders = Array.from(pendingOrders.values())
        .filter(order => new Date(order.timestamp).getTime() > oneHourAgo);
    
    res.json({
        service: "Auto Service WhatsApp Bot",
        server: {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            pid: process.pid,
            nodeVersion: process.version
        },
        whatsapp: {
            connected: isWhatsappConnected,
            hasQR: !!qrCodeData,
            lastConnection: isWhatsappConnected ? new Date().toISOString() : null
        },
        orders: {
            total_pending: pendingOrders.size,
            recent_hour: recentOrders.length,
            oldest_pending: pendingOrders.size > 0 ? 
                Math.min(...Array.from(pendingOrders.values())
                    .map(order => new Date(order.timestamp).getTime())) : null
        },
        timestamp: getCurrentTime()
    });
});

// Route لإرسال إشعار جماعي (للإدارة)
app.post("/broadcast", async (req, res) => {
    if (!isWhatsappConnected) {
        return res.status(503).json({ error: "البوت غير متصل" });
    }

    try {
        const { message, target } = req.body;
        
        if (!message) {
            return res.status(400).json({ error: "الرسالة مطلوبة" });
        }

        let targetPhones = [];
        
        if (target === 'pending') {
            // إرسال لجميع العملاء الذين لديهم طلبات معلقة
            targetPhones = Array.from(pendingOrders.keys());
        } else if (target === 'all' && req.body.phones) {
            // إرسال لقائمة محددة من الأرقام
            targetPhones = req.body.phones;
        } else {
            return res.status(400).json({ error: "يجب تحديد الهدف (pending) أو قائمة أرقام" });
        }

        const results = [];
        
        for (const phone of targetPhones) {
            try {
                const formattedNumber = `20${phone}@s.whatsapp.net`;
                
                // رسالة إشعار محسنة
                const broadcastMessage = `🔔 *إشعار من اوتو سيرفس*

━━━━━━━━━━━━━━━━━━━━━━━━━━
${message}

━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 *تاريخ الإشعار:* ${getCurrentTime()}

🌟 *اوتو سيرفس - Auto Service*
شكراً لثقتك الدائمة بنا ❤️`;
                
                await sock.sendMessage(formattedNumber, { text: broadcastMessage });
                results.push({ phone, success: true });
                
                // تأخير قصير بين الرسائل لتجنب الحظر
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (error) {
                results.push({ phone, success: false, error: error.message });
            }
        }

        res.json({
            success: true,
            message: "تم إرسال الإشعارات",
            results: results,
            total: targetPhones.length,
            successful: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length
        });

    } catch (error) {
        console.error('❌ خطأ في الإرسال الجماعي:', error);
        res.status(500).json({ error: error.message });
    }
});

// Route لتنظيف الطلبات المنتهية الصلاحية
app.post("/cleanup", (req, res) => {
    try {
        const now = Date.now();
        const expireTime = req.query.hours ? 
            parseInt(req.query.hours) * 60 * 60 * 1000 : 
            24 * 60 * 60 * 1000; // 24 ساعة افتراضياً
        
        let cleanedCount = 0;
        
        for (const [phone, orderData] of pendingOrders.entries()) {
            const orderTime = new Date(orderData.timestamp).getTime();
            if (now - orderTime > expireTime) {
                pendingOrders.delete(phone);
                cleanedCount++;
                console.log(`🗑️ تم حذف الطلب المنتهي الصلاحية: ${orderData.orderId}`);
            }
        }
        
        res.json({
            success: true,
            message: `تم تنظيف ${cleanedCount} طلب منتهي الصلاحية`,
            cleaned: cleanedCount,
            remaining: pendingOrders.size
        });
        
    } catch (error) {
        console.error('❌ خطأ في التنظيف:', error);
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
    
    // حفظ الطلبات المعلقة قبل الإغلاق
    if (pendingOrders.size > 0) {
        try {
            const ordersBackup = Array.from(pendingOrders.entries());
            fs.writeFileSync('pending_orders_backup.json', JSON.stringify(ordersBackup, null, 2));
            console.log(`💾 تم حفظ ${pendingOrders.size} طلب معلق في backup`);
        } catch (backupError) {
            console.error('❌ خطأ في حفظ النسخة الاحتياطية:', backupError);
        }
    }
    
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

// دالة لاستعادة الطلبات المعلقة عند بدء التشغيل
function restorePendingOrders() {
    try {
        if (fs.existsSync('pending_orders_backup.json')) {
            const backupData = JSON.parse(fs.readFileSync('pending_orders_backup.json', 'utf8'));
            const now = Date.now();
            let restoredCount = 0;
            
            for (const [phone, orderData] of backupData) {
                // استعادة الطلبات التي لا تزال صالحة (أقل من 48 ساعة)
                const orderTime = new Date(orderData.timestamp).getTime();
                if (now - orderTime < 48 * 60 * 60 * 1000) {
                    pendingOrders.set(phone, orderData);
                    restoredCount++;
                }
            }
            
            if (restoredCount > 0) {
                console.log(`📥 تم استعادة ${restoredCount} طلب معلق من النسخة الاحتياطية`);
            }
            
            // حذف ملف النسخة الاحتياطية بعد الاستعادة
            fs.unlinkSync('pending_orders_backup.json');
        }
    } catch (error) {
        console.error('❌ خطأ في استعادة الطلبات المعلقة:', error);
    }
}

// بدء الخادم
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`🚀 Auto Service WhatsApp Bot شغال على http://${HOST}:${PORT}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📊 Memory Usage:`, process.memoryUsage());
    console.log(`⏰ Server Start Time: ${getCurrentTime()}`);
    
    // استعادة الطلبات المعلقة
    restorePendingOrders();
    
    // بدء البوت بعد تشغيل الخادم
    setTimeout(() => {
        startBot();
    }, 3000);
    
    // تنظيف دوري للطلبات منتهية الصلاحية (كل 4 ساعات)
    setInterval(() => {
        const now = Date.now();
        let cleanedCount = 0;
        
        for (const [phone, orderData] of pendingOrders.entries()) {
            const orderTime = new Date(orderData.timestamp).getTime();
            if (now - orderTime > 48 * 60 * 60 * 1000) { // 48 ساعة
                pendingOrders.delete(phone);
                cleanedCount++;
            }
        }
        
        if (cleanedCount > 0) {
            console.log(`🗑️ تنظيف تلقائي: تم حذف ${cleanedCount} طلب منتهي الصلاحية`);
        }
    }, 4 * 60 * 60 * 1000); // كل 4 ساعات
});