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

let isWhatsappConnected = false;
let qrCodeData = null;
let sock = null;

// متغيرات Easy Order
const EASY_ORDER_API_URL = process.env.EASY_ORDER_API_URL || "https://your-easyorder-domain.com/api";
const EASY_ORDER_API_KEY = process.env.EASY_ORDER_API_KEY || "your-api-key";

// تخزين مؤقت للطلبات
const pendingOrders = new Map();

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
                    if (text.toLowerCase().includes("موافق") || text.toLowerCase().includes("تم") || text.toLowerCase().includes("تأكيد")) {
                        await handleOrderConfirmation(userPhone, orderData, message.key.remoteJid, true);
                    } else if (text.toLowerCase().includes("الغاء") || text.toLowerCase().includes("إلغاء") || text.toLowerCase().includes("رفض")) {
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

// دالة لمعالجة تأكيد أو إلغاء الطلب
async function handleOrderConfirmation(userPhone, orderData, chatId, isConfirmed) {
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
        pendingOrders.delete(userPhone);
        
        console.log(`✅ ${isConfirmed ? 'تم تأكيد' : 'تم إلغاء'} الطلب ${orderData.orderId}`);
        
    } catch (error) {
        console.error('❌ خطأ في معالجة تأكيد الطلب:', error);
        
        // إرسال رسالة خطأ
        await sock.sendMessage(chatId, { 
            text: "❌ حدث خطأ في معالجة طلبك. يرجى المحاولة مرة أخرى أو الاتصال بالدعم." 
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
            notes: `تم ${status === 'confirmed' ? 'تأكيد' : 'إلغاء'} الطلب عبر WhatsApp Bot`
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
        
        // يمكن إضافة نظام إعادة المحاولة هنا
        // أو حفظ الطلبات الفاشلة في قاعدة بيانات للمعالجة لاحقاً
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
                        background: linear-gradient(135deg, #25D366, #128C7E);
                        text-align: center;
                        padding: 20px;
                        box-sizing: border-box;
                    }
                    .container { 
                        background: white; 
                        padding: 40px; 
                        border-radius: 15px; 
                        box-shadow: 0 10px 30px rgba(0,0,0,0.2); 
                        max-width: 400px;
                        width: 100%;
                        animation: fadeIn 0.5s ease-in;
                    }
                    @keyframes fadeIn {
                        from { opacity: 0; transform: translateY(20px); }
                        to { opacity: 1; transform: translateY(0); }
                    }
                    img { 
                        border: 3px solid #25D366; 
                        border-radius: 15px; 
                        margin: 20px 0; 
                        max-width: 100%;
                        height: auto;
                        box-shadow: 0 5px 15px rgba(0,0,0,0.1);
                    }
                    .status { 
                        color: #25D366; 
                        font-weight: bold; 
                        font-size: 18px;
                    }
                    h1 { color: #128C7E; }
                    .loader {
                        border: 4px solid #f3f3f3;
                        border-top: 4px solid #25D366;
                        border-radius: 50%;
                        width: 30px;
                        height: 30px;
                        animation: spin 2s linear infinite;
                        margin: 20px auto;
                    }
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                </style>
                <script>
                    setTimeout(() => window.location.reload(), 5000);
                </script>
            </head>
            <body>
                <div class="container">
                    <h1>🤖 WhatsApp Bot</h1>
                    <h2>امسح الرمز باستخدام واتساب</h2>
                    <img src="${qrCodeData}" alt="QR Code">
                    <div class="loader"></div>
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
                        background: linear-gradient(135deg, #25D366, #128C7E);
                        color: white; 
                        text-align: center;
                        padding: 20px;
                        box-sizing: border-box;
                    }
                    .status-card {
                        background: rgba(255,255,255,0.1);
                        padding: 30px;
                        border-radius: 15px;
                        backdrop-filter: blur(10px);
                        box-shadow: 0 10px 30px rgba(0,0,0,0.2);
                        animation: pulse 2s infinite;
                    }
                    @keyframes pulse {
                        0% { transform: scale(1); }
                        50% { transform: scale(1.05); }
                        100% { transform: scale(1); }
                    }
                    .stats {
                        display: flex;
                        gap: 20px;
                        margin-top: 20px;
                        flex-wrap: wrap;
                        justify-content: center;
                    }
                    .stat-item {
                        background: rgba(255,255,255,0.2);
                        padding: 15px;
                        border-radius: 10px;
                        min-width: 120px;
                    }
                </style>
            </head>
            <body>
                <div class="status-card">
                    <h1>✅ البوت متصل بنجاح!</h1>
                    <p>🤖 WhatsApp Bot is running and ready</p>
                    <p>📱 جاهز لاستقبال الطلبات من Easy Order</p>
                    
                    <div class="stats">
                        <div class="stat-item">
                            <div>📊 الطلبات المعلقة</div>
                            <div>${pendingOrders.size}</div>
                        </div>
                        <div class="stat-item">
                            <div>⏱️ وقت التشغيل</div>
                            <div>${Math.floor(process.uptime() / 60)} دقيقة</div>
                        </div>
                    </div>
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

// Webhook لاستقبال طلبات Easy Order (محدث)
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
        
        // استخراج البيانات
        const orderId = data.id || data.order_id || Date.now().toString();
        const customerName = data.full_name || data.customer_name || data.name || "عميلنا الكريم";
        const customerPhone = data.phone || data.customer_phone || data.mobile || null;
        const total = data.total_cost || data.total || data.totalAmount || data.amount || "سيتم تحديده";
        const address = data.address || data.shipping_address || "غير محدد";
        const items = data.cart_items || data.items || data.products || [];
        
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

        // تنسيق قائمة المنتجات
        let itemsList = "";
        if (items && Array.isArray(items) && items.length > 0) {
            itemsList = items.map((item, index) => {
                const name = item.product?.name || item.name || item.title || `منتج ${index + 1}`;
                const qty = item.quantity || item.qty || 1;
                const price = item.price || item.unit_price || '';
                return `• ${name}: ${qty} قطعة${price ? ` (${price} ج.م)` : ''}`;
            }).join("\n");
        }
        
        // صياغة الرسالة مع الأزرار
        const message = `🌟 مرحباً ${customerName}\n\n` +
                       `شكرًا لاختيارك اوتو سيرفس! تم استلام طلبك:\n\n` +
                       `🆔 رقم الطلب: ${orderId}\n\n` +
                       (itemsList ? `🛍️ تفاصيل الطلب:\n${itemsList}\n\n` : '') +
                       `💰 الإجمالي: ${total} ج.م\n` +
                       `📍 عنوان التوصيل: ${address}\n\n` +
                       `⚠️ المعاينة غير متاحة وقت الاستلام\n` +
                       `يُرجى تأكيد الطلب للمتابعة:`;

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

        // تنسيق رقم الهاتف
        let formattedNumber = customerPhone.toString().trim().replace(/[\s\-\(\)]/g, '');
        
        if (formattedNumber.startsWith('0')) {
            formattedNumber = '20' + formattedNumber.substring(1);
        } else if (!formattedNumber.startsWith('20')) {
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
        
        // إعداد timeout لحذف الطلب بعد ساعة إذا لم يتم الرد
        setTimeout(() => {
            if (pendingOrders.has(phoneKey)) {
                console.log(`⏰ انتهت صلاحية الطلب ${orderId} - حذف من الذاكرة`);
                pendingOrders.delete(phoneKey);
            }
        }, 60 * 60 * 1000); // ساعة واحدة
        
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
        
        // إرسال رسالة إلغاء للعميل
        const formattedNumber = `20${phoneKey}@s.whatsapp.net`;
        await sock.sendMessage(formattedNumber, {
            text: `❌ تم إلغاء طلبك رقم ${orderId} من قِبل الإدارة.\nنأسف لأي إزعاج قد يكون حدث.`
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

// Health check لـ Render
app.get("/health", (req, res) => {
    res.json({ 
        status: "OK", 
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        connected: isWhatsappConnected,
        timestamp: new Date().toISOString(),
        pendingOrders: pendingOrders.size
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
        
        res.json({ success: true, message: "تم إعادة تشغيل البوت" });
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
        server: {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            pid: process.pid
        },
        whatsapp: {
            connected: isWhatsappConnected,
            hasQR: !!qrCodeData
        },
        orders: {
            total_pending: pendingOrders.size,
            recent_hour: recentOrders.length,
            oldest_pending: pendingOrders.size > 0 ? 
                Math.min(...Array.from(pendingOrders.values())
                    .map(order => new Date(order.timestamp).getTime())) : null
        },
        timestamp: new Date().toISOString()
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
                await sock.sendMessage(formattedNumber, { text: message });
                results.push({ phone, success: true });
                
                // تأخير قصير بين الرسائل لتجنب الحظر
                await new Promise(resolve => setTimeout(resolve, 1000));
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
    
    // حفظ الطلبات المعلقة قبل الإغلاق (اختياري)
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

// دالة لاستعادة الطلبات المعلقة عند بدء التشغيل (اختياري)
function restorePendingOrders() {
    try {
        if (fs.existsSync('pending_orders_backup.json')) {
            const backupData = JSON.parse(fs.readFileSync('pending_orders_backup.json', 'utf8'));
            const now = Date.now();
            let restoredCount = 0;
            
            for (const [phone, orderData] of backupData) {
                // استعادة الطلبات التي لا تزال صالحة (أقل من 24 ساعة)
                const orderTime = new Date(orderData.timestamp).getTime();
                if (now - orderTime < 24 * 60 * 60 * 1000) {
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
    console.log(`🚀 Server شغال على http://${HOST}:${PORT}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📊 Memory Usage:`, process.memoryUsage());
    
    // استعادة الطلبات المعلقة
    restorePendingOrders();
    
    // بدء البوت بعد تشغيل الخادم
    setTimeout(() => {
        startBot();
    }, 2000);
    
    // تنظيف دوري للطلبات منتهية الصلاحية (كل 6 ساعات)
    setInterval(() => {
        const now = Date.now();
        let cleanedCount = 0;
        
        for (const [phone, orderData] of pendingOrders.entries()) {
            const orderTime = new Date(orderData.timestamp).getTime();
            if (now - orderTime > 24 * 60 * 60 * 1000) { // 24 ساعة
                pendingOrders.delete(phone);
                cleanedCount++;
            }
        }
        
        if (cleanedCount > 0) {
            console.log(`🗑️ تنظيف تلقائي: تم حذف ${cleanedCount} طلب منتهي الصلاحية`);
        }
    }, 6 * 60 * 60 * 1000); // كل 6 ساعات
});