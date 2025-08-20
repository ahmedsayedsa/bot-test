// بوت واتساب محسن مع أزرار تفاعلية وتكامل Easy Order
const express = require("express");
const fs = require("fs");
const crypto = require("crypto");
const axios = require("axios");

// إضافة crypto polyfill
global.crypto = crypto;
if (crypto.webcrypto) {
    global.crypto.webcrypto = crypto.webcrypto;
}

const makeWASocket = require("@whiskeysockets/baileys").default;
const { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode");

// متغيرات البيئة
const PORT = process.env.PORT || 3000;
const EASY_ORDER_API_URL = process.env.EASY_ORDER_API_URL || "https://your-easyorder-domain.com/api";
const EASY_ORDER_API_KEY = process.env.EASY_ORDER_API_KEY || "your-api-key";

// متغيرات البوت
let isWhatsappConnected = false;
let qrCodeData = null;
let sock = null;
let connectionRetries = 0;
const MAX_RETRIES = 5;

// تخزين مؤقت للطلبات مع معلومات إضافية
const pendingOrders = new Map();
const orderTimeouts = new Map();

// دوال مساعدة
function stripHtml(html) {
    if (!html || typeof html !== 'string') return '';
    return html
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

function formatPhoneNumber(phone) {
    if (!phone) return null;
    
    let formatted = phone.toString().trim().replace(/[\s\-\(\)\+]/g, '');
    
    // إزالة الأصفار البادئة
    if (formatted.startsWith('00')) {
        formatted = formatted.substring(2);
    } else if (formatted.startsWith('0')) {
        formatted = '20' + formatted.substring(1);
    } else if (!formatted.startsWith('20') && !formatted.startsWith('1')) {
        formatted = '20' + formatted;
    }
    
    return formatted + '@s.whatsapp.net';
}

function generateOrderMessage(orderData) {
    const { orderId, customerName, items, total, address } = orderData;
    
    let message = `🌟 أهلاً وسهلاً ${customerName}\n\n` +
                 `شكرًا لاختيارك اوتو سيرفس! تم استلام طلبك بنجاح 🎉\n\n` +
                 `🆔 رقم الطلب: #${orderId.toString().slice(-6)}\n\n`;
    
    // تنسيق قائمة المنتجات
    if (items && Array.isArray(items) && items.length > 0) {
        const itemsList = items.map((item, index) => {
            const name = item.product?.name || item.name || item.title || `منتج ${index + 1}`;
            const qty = item.quantity || item.qty || item.pivot?.quantity || 1;
            
            let price = '';
            if (item.sale_price && item.sale_price > 0) {
                price = item.sale_price;
            } else if (item.price) {
                price = item.price;
            } else if (item.product?.sale_price && item.product.sale_price > 0) {
                price = item.product.sale_price;
            } else if (item.product?.price) {
                price = item.product.price;
            }
            
            let line = `• ${name}`;
            if (qty > 1) {
                line += `: ${qty} قطعة`;
            }
            if (price) {
                line += ` (${price} ج.م${qty > 1 ? ' للقطعة' : ''})`;
            }
            
            return line;
        }).join("\n");
        
        message += `🛍️ تفاصيل الطلب:\n${itemsList}\n\n`;
    }
    
    message += `💰 الإجمالي: ${total} ج.م\n`;
    
    if (address && address !== "غير محدد") {
        message += `📍 عنوان التوصيل: ${address}\n`;
    }
    
    message += `\n⚠️ ملاحظة مهمة: المعاينة غير متاحة وقت الاستلام\n` +
              `🔄 يُرجى تأكيد طلبك للبدء في التحضير والشحن:`;
    
    return message;
}

// دالة بدء البوت مع معالجة أفضل للأخطاء
async function startBot() {
    try {
        console.log("🚀 بدء تشغيل البوت...");
        
        const { state, saveCreds } = await useMultiFileAuthState("auth_info");
        const { version } = await fetchLatestBaileysVersion();
        
        sock = makeWASocket({
            auth: state,
            version,
            printQRInTerminal: false,
            browser: ["WhatsApp Bot Enhanced", "Chrome", "4.0.0"],
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 0,
            keepAliveIntervalMs: 10000,
            markOnlineOnConnect: false,
            generateHighQualityLinkPreview: false,
            syncFullHistory: false,
            getMessage: async (key) => {
                return { conversation: "Message not found" };
            }
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
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log('❌ الاتصال مقطوع:', lastDisconnect?.error, 'إعادة الاتصال:', shouldReconnect);
                
                isWhatsappConnected = false;
                
                if (shouldReconnect && connectionRetries < MAX_RETRIES) {
                    connectionRetries++;
                    console.log(`🔄 محاولة إعادة الاتصال ${connectionRetries}/${MAX_RETRIES}`);
                    setTimeout(() => startBot(), 10000 * connectionRetries);
                } else if (lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut) {
                    console.log('❌ البوت محتاج تسجيل دخول جديد');
                    try {
                        if (fs.existsSync("auth_info")) {
                            fs.rmSync("auth_info", { recursive: true, force: true });
                        }
                    } catch (cleanupError) {
                        console.error('❌ خطأ في حذف auth_info:', cleanupError);
                    }
                    connectionRetries = 0;
                    setTimeout(() => startBot(), 5000);
                } else {
                    console.log('❌ فشل في الاتصال بعد عدة محاولات');
                }
            } else if (connection === 'open') {
                console.log('✅ البوت متصل بواتساب بنجاح!');
                isWhatsappConnected = true;
                qrCodeData = null;
                connectionRetries = 0;
                
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

        // معالجة الرسائل الواردة مع دعم أفضل للأزرار
        sock.ev.on("messages.upsert", async (m) => {
            try {
                const message = m.messages[0];
                if (!message.message || message.key.fromMe) return;
                
                const userPhone = message.key.remoteJid.replace('@s.whatsapp.net', '');
                const phoneKey = userPhone.replace(/^20/, '');
                
                console.log(`📨 رسالة واردة من ${message.key.remoteJid}`);
                
                // التعامل مع ردود الأزرار التفاعلية
                if (message.message.buttonsResponseMessage) {
                    const buttonId = message.message.buttonsResponseMessage.selectedButtonId;
                    const orderData = pendingOrders.get(phoneKey);
                    
                    if (orderData && buttonId) {
                        await handleButtonResponse(buttonId, phoneKey, orderData, message.key.remoteJid);
                        return;
                    }
                }
                
                // التعامل مع الردود النصية كبديل للأزرار
                const text = message.message.conversation || 
                           message.message.extendedTextMessage?.text || "";
                
                if (text) {
                    const orderData = pendingOrders.get(phoneKey);
                    if (orderData) {
                        if (text.toLowerCase().includes("موافق") || 
                            text.toLowerCase().includes("تم") || 
                            text.toLowerCase().includes("تأكيد") ||
                            text.toLowerCase().includes("نعم")) {
                            await handleOrderConfirmation(phoneKey, orderData, message.key.remoteJid, true);
                        } else if (text.toLowerCase().includes("الغاء") || 
                                  text.toLowerCase().includes("إلغاء") || 
                                  text.toLowerCase().includes("رفض") ||
                                  text.toLowerCase().includes("لا")) {
                            await handleOrderConfirmation(phoneKey, orderData, message.key.remoteJid, false);
                        }
                    }
                }
                
            } catch (msgError) {
                console.error('❌ خطأ في معالجة الرسالة:', msgError);
            }
        });

    } catch (error) {
        console.error('❌ خطأ في بدء البوت:', error);
        if (connectionRetries < MAX_RETRIES) {
            connectionRetries++;
            setTimeout(() => startBot(), 15000 * connectionRetries);
        }
    }
}

// دالة معالجة ردود الأزرار
async function handleButtonResponse(buttonId, phoneKey, orderData, chatId) {
    try {
        console.log(`🔘 تم الضغط على الزر: ${buttonId} من ${phoneKey}`);
        
        if (buttonId === 'confirm_order') {
            await handleOrderConfirmation(phoneKey, orderData, chatId, true);
        } else if (buttonId === 'cancel_order') {
            await handleOrderConfirmation(phoneKey, orderData, chatId, false);
        }
    } catch (error) {
        console.error('❌ خطأ في معالجة رد الزر:', error);
    }
}

// دالة معالجة تأكيد أو إلغاء الطلب
async function handleOrderConfirmation(phoneKey, orderData, chatId, isConfirmed) {
    try {
        let responseMessage = "";
        let orderStatus = "";
        
        if (isConfirmed) {
            responseMessage = `✅ تم تأكيد طلبك بنجاح يا ${orderData.customerName}!\n\n` +
                            `📦 سيتم تجهيز طلبك وشحنه خلال 24-48 ساعة\n` +
                            `🚚 سيتم إرسال رقم الشحن قريباً\n` +
                            `📞 للاستفسارات: اتصل بنا\n\n` +
                            `شكراً لثقتك في اوتو سيرفس! 🙏`;
            orderStatus = "confirmed";
        } else {
            responseMessage = `❌ تم إلغاء طلبك يا ${orderData.customerName}\n\n` +
                            `نأسف لعدم تمكننا من خدمتك هذه المرة\n` +
                            `يمكنك تقديم طلب جديد في أي وقت\n\n` +
                            `نتطلع لخدمتك قريباً 😔`;
            orderStatus = "cancelled";
        }
        
        // إرسال الرسالة للعميل
        await sock.sendMessage(chatId, { text: responseMessage });
        
        // تحديث حالة الطلب في Easy Order
        await updateOrderStatusInEasyOrder(orderData.orderId, orderStatus, orderData);
        
        // حذف الطلب من الذاكرة المؤقتة
        pendingOrders.delete(phoneKey);
        
        // إلغاء timeout إذا كان موجود
        if (orderTimeouts.has(phoneKey)) {
            clearTimeout(orderTimeouts.get(phoneKey));
            orderTimeouts.delete(phoneKey);
        }
        
        console.log(`✅ ${isConfirmed ? 'تم تأكيد' : 'تم إلغاء'} الطلب ${orderData.orderId}`);
        
    } catch (error) {
        console.error('❌ خطأ في معالجة تأكيد الطلب:', error);
        
        // إرسال رسالة خطأ
        try {
            await sock.sendMessage(chatId, { 
                text: "❌ حدث خطأ في معالجة طلبك. يرجى المحاولة مرة أخرى أو الاتصال بالدعم." 
            });
        } catch (sendError) {
            console.error('❌ خطأ في إرسال رسالة الخطأ:', sendError);
        }
    }
}

// دالة تحديث حالة الطلب في Easy Order مع إعادة المحاولة
async function updateOrderStatusInEasyOrder(orderId, status, orderData, retryCount = 0) {
    const MAX_UPDATE_RETRIES = 3;
    
    try {
        const updateData = {
            order_id: orderId,
            status: status,
            updated_at: new Date().toISOString(),
            notes: `تم ${status === 'confirmed' ? 'تأكيد' : 'إلغاء'} الطلب عبر WhatsApp Bot`,
            customer_phone: orderData.customerPhone,
            customer_name: orderData.customerName
        };
        
        console.log(`📤 تحديث حالة الطلب في Easy Order: ${orderId} -> ${status} (محاولة ${retryCount + 1})`);
        
        // محاولة عدة endpoints محتملة لـ Easy Order
        const possibleEndpoints = [
            `${EASY_ORDER_API_URL}/orders/${orderId}/update-status`,
            `${EASY_ORDER_API_URL}/orders/${orderId}/status`,
            `${EASY_ORDER_API_URL}/order/update/${orderId}`,
            `${EASY_ORDER_API_URL}/webhook/order-status`
        ];
        
        let response = null;
        let lastError = null;
        
        for (const endpoint of possibleEndpoints) {
            try {
                response = await axios.post(endpoint, updateData, {
                    headers: {
                        'Authorization': `Bearer ${EASY_ORDER_API_KEY}`,
                        'Content-Type': 'application/json',
                        'X-API-Key': EASY_ORDER_API_KEY,
                        'User-Agent': 'WhatsApp-Bot/1.0'
                    },
                    timeout: 10000
                });
                
                if (response.status >= 200 && response.status < 300) {
                    console.log(`✅ تم تحديث الطلب ${orderId} في Easy Order بنجاح عبر ${endpoint}`);
                    return response;
                }
            } catch (endpointError) {
                lastError = endpointError;
                console.log(`⚠️ فشل endpoint ${endpoint}: ${endpointError.message}`);
                continue;
            }
        }
        
        // إذا فشلت جميع endpoints
        throw lastError || new Error('جميع endpoints فشلت');
        
    } catch (error) {
        console.error(`❌ خطأ في تحديث Easy Order للطلب ${orderId}:`, error.message);
        
        // إعادة المحاولة
        if (retryCount < MAX_UPDATE_RETRIES) {
            console.log(`🔄 إعادة المحاولة ${retryCount + 1}/${MAX_UPDATE_RETRIES} بعد 5 ثوان...`);
            setTimeout(() => {
                updateOrderStatusInEasyOrder(orderId, status, orderData, retryCount + 1);
            }, 5000);
        } else {
            console.error(`❌ فشل نهائي في تحديث الطلب ${orderId} بعد ${MAX_UPDATE_RETRIES} محاولات`);
            
            // حفظ الطلب الفاشل للمعالجة اليدوية
            const failedUpdate = {
                orderId,
                status,
                orderData,
                timestamp: new Date().toISOString(),
                error: error.message
            };
            
            try {
                let failedUpdates = [];
                if (fs.existsSync('failed_updates.json')) {
                    failedUpdates = JSON.parse(fs.readFileSync('failed_updates.json', 'utf8'));
                }
                failedUpdates.push(failedUpdate);
                fs.writeFileSync('failed_updates.json', JSON.stringify(failedUpdates, null, 2));
                console.log(`💾 تم حفظ الطلب الفاشل ${orderId} للمعالجة اليدوية`);
            } catch (saveError) {
                console.error('❌ خطأ في حفظ الطلب الفاشل:', saveError);
            }
        }
    }
}

// إعداد Express Server
const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// CORS headers
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

// Logging middleware
app.use((req, res, next) => {
    console.log(`📡 ${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// Route الرئيسي مع واجهة محسنة
app.get("/", (req, res) => {
    try {
        if (!isWhatsappConnected && qrCodeData) {
            const html = `
            <!DOCTYPE html>
            <html dir="rtl" lang="ar">
            <head>
                <title>WhatsApp Bot - QR Code</title>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <style>
                    * { box-sizing: border-box; }
                    body { 
                        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                        display: flex; 
                        flex-direction: column; 
                        align-items: center; 
                        justify-content: center; 
                        min-height: 100vh; 
                        margin: 0; 
                        background: linear-gradient(135deg, #25D366, #128C7E);
                        text-align: center;
                        padding: 20px;
                    }
                    .container { 
                        background: white; 
                        padding: 40px; 
                        border-radius: 20px; 
                        box-shadow: 0 15px 35px rgba(0,0,0,0.1); 
                        max-width: 450px;
                        width: 100%;
                        animation: slideUp 0.6s ease-out;
                    }
                    @keyframes slideUp {
                        from { opacity: 0; transform: translateY(30px); }
                        to { opacity: 1; transform: translateY(0); }
                    }
                    img { 
                        border: 3px solid #25D366; 
                        border-radius: 15px; 
                        margin: 20px 0; 
                        max-width: 100%;
                        height: auto;
                        box-shadow: 0 8px 20px rgba(0,0,0,0.1);
                    }
                    .status { 
                        color: #25D366; 
                        font-weight: bold; 
                        font-size: 18px;
                        margin: 15px 0;
                    }
                    h1 { 
                        color: #128C7E; 
                        margin-bottom: 10px;
                        font-size: 28px;
                    }
                    h2 {
                        color: #666;
                        font-size: 18px;
                        margin-bottom: 20px;
                    }
                    .loader {
                        border: 4px solid #f3f3f3;
                        border-top: 4px solid #25D366;
                        border-radius: 50%;
                        width: 40px;
                        height: 40px;
                        animation: spin 1s linear infinite;
                        margin: 20px auto;
                    }
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                    .instructions {
                        background: #f8f9fa;
                        padding: 15px;
                        border-radius: 10px;
                        margin: 20px 0;
                        font-size: 14px;
                        color: #666;
                    }
                </style>
                <script>
                    setTimeout(() => window.location.reload(), 10000);
                </script>
            </head>
            <body>
                <div class="container">
                    <h1>🤖 بوت واتساب</h1>
                    <h2>امسح الرمز باستخدام واتساب</h2>
                    <img src="${qrCodeData}" alt="QR Code">
                    <div class="loader"></div>
                    <p class="status">🔄 في انتظار المسح...</p>
                    <div class="instructions">
                        <strong>تعليمات:</strong><br>
                        1. افتح واتساب على هاتفك<br>
                        2. اذهب إلى الإعدادات > الأجهزة المرتبطة<br>
                        3. اضغط على "ربط جهاز"<br>
                        4. امسح الرمز أعلاه
                    </div>
                    <small>ستتم إعادة تحميل الصفحة تلقائياً كل 10 ثوان</small>
                </div>
            </body>
            </html>`;
            res.send(html);
        } else if (isWhatsappConnected) {
            const html = `
            <!DOCTYPE html>
            <html dir="rtl" lang="ar">
            <head>
                <title>WhatsApp Bot - متصل</title>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <style>
                    * { box-sizing: border-box; }
                    body { 
                        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                        display: flex; 
                        flex-direction: column; 
                        align-items: center; 
                        justify-content: center; 
                        min-height: 100vh; 
                        margin: 0; 
                        background: linear-gradient(135deg, #25D366, #128C7E);
                        color: white; 
                        text-align: center;
                        padding: 20px;
                    }
                    .status-card {
                        background: rgba(255,255,255,0.15);
                        padding: 40px;
                        border-radius: 20px;
                        backdrop-filter: blur(10px);
                        box-shadow: 0 15px 35px rgba(0,0,0,0.2);
                        animation: pulse 3s infinite;
                        max-width: 500px;
                        width: 100%;
                    }
                    @keyframes pulse {
                        0%, 100% { transform: scale(1); }
                        50% { transform: scale(1.02); }
                    }
                    .stats {
                        display: grid;
                        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
                        gap: 20px;
                        margin-top: 30px;
                    }
                    .stat-item {
                        background: rgba(255,255,255,0.2);
                        padding: 20px;
                        border-radius: 15px;
                        backdrop-filter: blur(5px);
                    }
                    .stat-number {
                        font-size: 24px;
                        font-weight: bold;
                        margin-bottom: 5px;
                    }
                    .stat-label {
                        font-size: 14px;
                        opacity: 0.9;
                    }
                    h1 {
                        font-size: 32px;
                        margin-bottom: 10px;
                    }
                    .status-indicator {
                        display: inline-block;
                        width: 12px;
                        height: 12px;
                        background: #4CAF50;
                        border-radius: 50%;
                        margin-left: 10px;
                        animation: blink 2s infinite;
                    }
                    @keyframes blink {
                        0%, 50% { opacity: 1; }
                        51%, 100% { opacity: 0.3; }
                    }
                </style>
                <script>
                    setTimeout(() => window.location.reload(), 30000);
                </script>
            </head>
            <body>
                <div class="status-card">
                    <h1>🤖 بوت واتساب</h1>
                    <h2>✅ متصل ويعمل بنجاح <span class="status-indicator"></span></h2>
                    <p>البوت جاهز لاستقبال الطلبات من Easy Order</p>
                    
                    <div class="stats">
                        <div class="stat-item">
                            <div class="stat-number">${pendingOrders.size}</div>
                            <div class="stat-label">طلبات معلقة</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-number">${Math.floor(process.uptime() / 60)}</div>
                            <div class="stat-label">دقائق تشغيل</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-number">${connectionRetries}</div>
                            <div class="stat-label">محاولات الاتصال</div>
                        </div>
                    </div>
                    
                    <p style="margin-top: 30px; font-size: 14px; opacity: 0.8;">
                        آخر تحديث: ${new Date().toLocaleString('ar-EG')}
                    </p>
                </div>
            </body>
            </html>`;
            res.send(html);
        } else {
            res.json({ 
                status: "initializing", 
                message: "البوت في مرحلة التهيئة...",
                connected: false,
                retries: connectionRetries
            });
        }
    } catch (error) {
        console.error('❌ خطأ في الصفحة الرئيسية:', error);
        res.status(500).json({ error: error.message });
    }
});

// Route معالجة الطلبات من Easy Order
app.post("/send-order", async (req, res) => {
    if (!isWhatsappConnected) {
        return res.status(503).json({ 
            error: "البوت غير متصل بواتساب",
            connected: false,
            qrAvailable: !!qrCodeData
        });
    }

    try {
        const data = req.body;
        console.log("📥 طلب جديد وارد:", JSON.stringify(data, null, 2));

        // استخراج بيانات الطلب مع مرونة أكبر
        const orderId = data.order_id || data.id || data.order?.id || "غير محدد";
        const customerName = data.customer_name || data.customer?.name || data.name || "عميل";
        const customerPhone = data.customer_phone || data.customer?.phone || data.phone || data.customer?.mobile;
        const total = data.total || data.amount || data.price || data.order?.total || "سيتم تحديده";
        const address = data.address || data.shipping_address || data.customer?.address || "غير محدد";

        // استخراج المنتجات
        let items = [];
        if (data.order_items && Array.isArray(data.order_items)) {
            items = data.order_items;
        } else if (data.items && Array.isArray(data.items)) {
            items = data.items;
        } else if (data.products && Array.isArray(data.products)) {
            items = data.products;
        } else if (data.product) {
            items = [data.product];
        } else if (data.name && data.price) {
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
                error: "رقم هاتف العميل مطلوب",
                receivedData: data
            });
        }

        // إنشاء بيانات الطلب
        const orderData = {
            orderId: orderId,
            customerName: customerName,
            customerPhone: customerPhone,
            total: total,
            address: address,
            items: items,
            timestamp: new Date().toISOString()
        };

        // تنسيق رقم الهاتف
        const formattedNumber = formatPhoneNumber(customerPhone);
        if (!formattedNumber) {
            return res.status(400).json({ error: "رقم هاتف غير صحيح" });
        }

        // إنشاء الرسالة
        const message = generateOrderMessage(orderData);

        // إنشاء الأزرار التفاعلية
        const buttons = [
            {
                buttonId: 'confirm_order',
                buttonText: { displayText: '✅ تأكيد الطلب' },
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

        // حفظ الطلب في الذاكرة المؤقتة
        const phoneKey = customerPhone.toString().replace(/[\s\-\(\)]/g, '').replace(/^0/, '').replace(/^20/, '');
        pendingOrders.set(phoneKey, orderData);

        console.log(`📞 الرقم المنسق: ${formattedNumber}`);
        console.log("📤 محاولة إرسال الرسالة مع الأزرار...");

        // إرسال الرسالة مع الأزرار
        await sock.sendMessage(formattedNumber, buttonMessage);

        console.log(`✅ تم إرسال الطلب مع الأزرار للعميل بنجاح`);

        // إعداد timeout لحذف الطلب بعد ساعة إذا لم يتم الرد
        const timeoutId = setTimeout(() => {
            if (pendingOrders.has(phoneKey)) {
                console.log(`⏰ انتهت صلاحية الطلب ${orderId} - حذف من الذاكرة`);
                pendingOrders.delete(phoneKey);
                orderTimeouts.delete(phoneKey);
            }
        }, 60 * 60 * 1000); // ساعة واحدة

        orderTimeouts.set(phoneKey, timeoutId);

        res.json({ 
            success: true, 
            message: "تم إرسال الرسالة مع الأزرار بنجاح",
            orderId: orderId,
            sentTo: customerPhone,
            customerName: customerName,
            formattedNumber: formattedNumber,
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

// Routes إضافية للإدارة والمراقبة
app.get("/pending-orders", (req, res) => {
    const orders = Array.from(pendingOrders.entries()).map(([phone, data]) => ({
        phone: phone,
        ...data,
        timeRemaining: orderTimeouts.has(phone) ? "متاح" : "منتهي"
    }));
    
    res.json({
        count: pendingOrders.size,
        orders: orders,
        timestamp: new Date().toISOString()
    });
});

app.get("/health", (req, res) => {
    res.json({ 
        status: "OK", 
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        connected: isWhatsappConnected,
        timestamp: new Date().toISOString(),
        pendingOrders: pendingOrders.size,
        connectionRetries: connectionRetries
    });
});

app.post("/restart", (req, res) => {
    try {
        console.log("🔄 إعادة تشغيل البوت...");
        isWhatsappConnected = false;
        qrCodeData = null;
        connectionRetries = 0;
        
        // مسح الطلبات المعلقة والـ timeouts
        pendingOrders.clear();
        orderTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
        orderTimeouts.clear();
        
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

// معالجة الأخطاء
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, closing gracefully...');
    
    // حفظ الطلبات المعلقة
    if (pendingOrders.size > 0) {
        try {
            const ordersBackup = Array.from(pendingOrders.entries());
            fs.writeFileSync('pending_orders_backup.json', JSON.stringify(ordersBackup, null, 2));
            console.log(`💾 تم حفظ ${pendingOrders.size} طلب معلق`);
        } catch (backupError) {
            console.error('❌ خطأ في حفظ النسخة الاحتياطية:', backupError);
        }
    }
    
    if (sock) {
        sock.end();
    }
    process.exit(0);
});

// بدء الخادم والبوت
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 الخادم يعمل على المنفذ ${PORT}`);
    console.log(`🌐 الرابط: http://localhost:${PORT}`);
    
    // بدء البوت بعد تشغيل الخادم
    setTimeout(() => {
        startBot();
    }, 1000);
});

// تصدير للاختبار
module.exports = { app, startBot };

