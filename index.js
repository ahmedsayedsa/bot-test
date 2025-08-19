// استيراد المكتبات المطلوبة
const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// إضافة crypto polyfill للـ global scope
global.crypto = crypto;
if (crypto.webcrypto) {
    global.crypto.webcrypto = crypto.webcrypto;
}

const makeWASocket = require("@whiskeysockets/baileys").default;
const { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode");

// دالة لتحديث حالة الطلب في Easy Order
async function updateOrderStatus(customerPhone, status, notes = '') {
    try {
        const easyOrderWebhookUrl = process.env.EASYORDER_UPDATE_URL || 'https://your-easyorder-webhook.com/update-order';
        
        const updateData = {
            customer_phone: customerPhone,
            status: status, // 'confirmed', 'cancelled', 'processing', 'shipped', 'delivered'
            notes: notes,
            updated_by: 'whatsapp_bot',
            timestamp: new Date().toISOString()
        };
        
        console.log(`🔄 محاولة تحديث حالة الطلب في Easy Order:`, updateData);
        
        // تجربة fetch مع error handling أحسن
        const response = await fetch(easyOrderWebhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.EASYORDER_API_KEY || ''}`,
            },
            body: JSON.stringify(updateData),
            timeout: 10000 // 10 seconds timeout
        });
        
        if (response.ok) {
            const result = await response.json();
            console.log(`✅ تم تحديث حالة الطلب في Easy Order بنجاح:`, result);
            return { success: true, data: result };
        } else {
            console.error(`❌ فشل في تحديث Easy Order:`, response.status, await response.text());
            return { success: false, error: `HTTP ${response.status}` };
        }
        
    } catch (error) {
        console.error('❌ خطأ في تحديث حالة الطلب:', error.message);
        return { success: false, error: error.message };
    }
}

let isWhatsappConnected = false;
let qrCodeData = null;
let sock = null;
let connectionRetries = 0;
const maxRetries = 5;

// دالة لحفظ معلومات الاتصال بشكل مستمر
async function saveAuthInfo() {
    try {
        const authDir = path.join(__dirname, 'auth_info_persistent');
        if (!fs.existsSync(authDir)) {
            fs.mkdirSync(authDir, { recursive: true });
        }
        console.log('📁 Auth info directory ready:', authDir);
        return authDir;
    } catch (error) {
        console.error('❌ خطأ في إنشاء مجلد الحفظ:', error);
        return 'auth_info';
    }
}

async function startBot() {
    try {
        console.log("🚀 بدء تشغيل البوت...");
        
        // استخدام مجلد ثابت للحفظ
        const authDir = await saveAuthInfo();
        const { state, saveCreds } = await useMultiFileAuthState(authDir);
        const { version } = await fetchLatestBaileysVersion();
        
        console.log(`📱 Baileys version: ${version}`);
        
        sock = makeWASocket({
            auth: state,
            version,
            printQRInTerminal: false,
            browser: ["AutoService Bot", "Chrome", "4.0.0"],
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 0,
            keepAliveIntervalMs: 10000,
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: false,
            syncFullHistory: false,
            // تحسين الاتصال
            retryRequestDelayMs: 250,
            maxMsgRetryCount: 3,
            transactionOpts: {
                maxCommitRetries: 10,
                delayBetweenTriesMs: 3000
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
                    
                    // حفظ QR في ملف للوصول إليه
                    fs.writeFileSync(path.join(__dirname, 'current_qr.txt'), qr);
                } catch (qrError) {
                    console.error('❌ خطأ في إنشاء QR:', qrError);
                }
            }

            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log('❌ الاتصال مقطوع:', lastDisconnect?.error, 'إعادة الاتصال:', shouldReconnect);
                
                isWhatsappConnected = false;
                qrCodeData = null;
                
                if (shouldReconnect && connectionRetries < maxRetries) {
                    connectionRetries++;
                    console.log(`🔄 محاولة إعادة الاتصال ${connectionRetries}/${maxRetries}`);
                    setTimeout(() => startBot(), 5000 * connectionRetries);
                } else if (lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut) {
                    console.log('❌ تم تسجيل الخروج، حذف بيانات المصادقة...');
                    try {
                        const authDir = path.join(__dirname, 'auth_info_persistent');
                        if (fs.existsSync(authDir)) {
                            fs.rmSync(authDir, { recursive: true, force: true });
                        }
                    } catch (cleanupError) {
                        console.error('❌ خطأ في حذف auth info:', cleanupError);
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
                
                // حذف ملف QR بعد الاتصال
                try {
                    const qrFile = path.join(__dirname, 'current_qr.txt');
                    if (fs.existsSync(qrFile)) {
                        fs.unlinkSync(qrFile);
                    }
                } catch (deleteError) {
                    console.error('❌ خطأ في حذف QR file:', deleteError);
                }
                
                // رسالة تأكيد (اختيارية)
                console.log('🎉 البوت جاهز لاستقبال الطلبات!');
                
            } else if (connection === 'connecting') {
                console.log('🔄 جاري الاتصال بواتساب...');
            }
        });

        // التعامل مع الرسائل الواردة
        sock.ev.on("messages.upsert", async (m) => {
            try {
                const message = m.messages[0];
                if (!message.message || message.key.fromMe) return;
                
                const customerJid = message.key.remoteJid;
                const customerPhone = customerJid.replace('@s.whatsapp.net', '');
                
                console.log(`📨 رسالة واردة من ${customerPhone}`);
                
                // معالجة Poll Updates (إجابات الاستفتاء)
                const pollUpdate = message.message.pollUpdateMessage;
                if (pollUpdate) {
                    try {
                        const vote = pollUpdate.vote;
                        if (vote && vote.selectedOptions && vote.selectedOptions.length > 0) {
                            const selectedOption = vote.selectedOptions[0];
                            console.log(`🗳️ استفتاء: العميل ${customerPhone} اختار الخيار: ${selectedOption}`);
                            
                            let responseText = "";
                            let orderStatus = "";
                            let statusNote = "";
                            
                            if (selectedOption === 0) { // ✅ تأكيد الطلب
                                responseText = "✅ ممتاز! تم تأكيد طلبك بنجاح!\n\n🚚 سيتم تجهيز طلبك خلال 1-2 يوم عمل.\n📞 سنتواصل معك لترتيب موعد التوصيل.\n\n🙏 شكراً لثقتك في اوتو سيرفس!";
                                orderStatus = 'confirmed';
                                statusNote = 'تم تأكيد الطلب عبر الاستفتاء';
                                
                            } else if (selectedOption === 1) { // ❌ إلغاء الطلب  
                                responseText = "❌ تم إلغاء طلبك بناءً على اختيارك.\n\n😔 نأسف لعدم تمكننا من خدمتك هذه المرة.\n💡 يمكنك الطلب مرة أخرى في أي وقت.\n\n🤝 نتطلع لخدمتك قريباً!";
                                orderStatus = 'cancelled';
                                statusNote = 'تم إلغاء الطلب عبر الاستفتاء';
                            }
                            
                            if (responseText && orderStatus) {
                                // إرسال الرد
                                await sock.sendMessage(customerJid, { text: responseText });
                                
                                // تحديث حالة الطلب في Easy Order
                                const updateResult = await updateOrderStatus(customerPhone, orderStatus, statusNote);
                                if (updateResult.success) {
                                    console.log(`✅ تم تحديث الطلب في Easy Order: ${orderStatus}`);
                                } else {
                                    console.error(`❌ فشل تحديث Easy Order: ${updateResult.error}`);
                                }
                            }
                            return;
                        }
                    } catch (pollError) {
                        console.error('❌ خطأ في معالجة الاستفتاء:', pollError);
                    }
                }
                
                // معالجة الردود على الأزرار
                const buttonResponse = message.message.buttonsResponseMessage ||
                                     message.message.listResponseMessage ||
                                     message.message.templateButtonReplyMessage ||
                                     message.message.interactiveResponseMessage;
                
                let buttonId = null;
                
                if (buttonResponse) {
                    if (message.message.buttonsResponseMessage) {
                        buttonId = message.message.buttonsResponseMessage.selectedButtonId;
                    } else if (message.message.listResponseMessage) {
                        buttonId = message.message.listResponseMessage.singleSelectReply.selectedRowId;
                    } else if (message.message.templateButtonReplyMessage) {
                        buttonId = message.message.templateButtonReplyMessage.selectedId;
                    } else if (message.message.interactiveResponseMessage) {
                        const nativeFlow = message.message.interactiveResponseMessage.nativeFlowResponseMessage;
                        if (nativeFlow && nativeFlow.paramsJson) {
                            try {
                                const params = JSON.parse(nativeFlow.paramsJson);
                                buttonId = params.id;
                            } catch (e) {
                                console.log('❌ خطأ في تحليل Interactive Response');
                            }
                        }
                    }
                    
                    console.log(`🔲 تم الضغط على زر: ${buttonId} من العميل: ${customerPhone}`);
                    
                    let responseText = "";
                    let orderStatus = "";
                    let statusNote = "";
                    
                    if (buttonId === 'confirm_order') {
                        responseText = "✅ ممتاز! تم تأكيد طلبك بنجاح!\n\n🚚 سيتم تجهيز طلبك خلال 1-2 يوم عمل.\n📞 سنتواصل معك لترتيب موعد التوصيل.\n\n🙏 شكراً لثقتك في اوتو سيرفس!";
                        orderStatus = 'confirmed';
                        statusNote = 'تم تأكيد الطلب عبر الأزرار';
                        
                    } else if (buttonId === 'cancel_order') {
                        responseText = "❌ تم إلغاء طلبك بناءً على طلبك.\n\n😔 نأسف لعدم تمكننا من خدمتك هذه المرة.\n💡 يمكنك الطلب مرة أخرى في أي وقت.\n\n🤝 نتطلع لخدمتك قريباً!";
                        orderStatus = 'cancelled';
                        statusNote = 'تم إلغاء الطلب عبر الأزرار';
                    }
                    
                    if (responseText && orderStatus) {
                        await sock.sendMessage(customerJid, { text: responseText });
                        
                        // تحديث حالة الطلب
                        const updateResult = await updateOrderStatus(customerPhone, orderStatus, statusNote);
                        if (updateResult.success) {
                            console.log(`✅ تم تحديث الطلب في Easy Order: ${orderStatus}`);
                        } else {
                            console.error(`❌ فشل تحديث Easy Order: ${updateResult.error}`);
                        }
                    }
                    return;
                }
                
                // معالجة الردود النصية
                const text = message.message.conversation || 
                           message.message.extendedTextMessage?.text || "";
                
                if (text && text.trim()) {
                    const lowerText = text.toLowerCase().trim();
                    
                    // كلمات التأكيد
                    const confirmWords = ['موافق', 'تم', 'نعم', 'yes', 'ok', 'أوافق', 'اوافق', 'موافقه', 'تمام', 'اوكي', 'حاضر', 'ماشي', 'صح', 'كده'];
                    // كلمات الإلغاء
                    const cancelWords = ['إلغاء', 'الغاء', 'لا', 'no', 'رفض', 'مش موافق', 'لأ', 'لاء', 'مش عايز', 'مش عاوز', 'cancel'];
                    
                    const isConfirm = confirmWords.some(word => lowerText.includes(word));
                    const isCancel = cancelWords.some(word => lowerText.includes(word));
                    
                    console.log(`📝 رد نصي من ${customerPhone}: "${text}" | تأكيد: ${isConfirm} | إلغاء: ${isCancel}`);
                    
                    let responseText = "";
                    let orderStatus = "";
                    let statusNote = "";
                    
                    if (isConfirm) {
                        responseText = "✅ ممتاز! تم تأكيد طلبك بنجاح!\n\n🚚 سيتم تجهيز طلبك خلال 1-2 يوم عمل.\n📞 سنتواصل معك لترتيب موعد التوصيل.\n\n🙏 شكراً لثقتك في اوتو سيرفس!";
                        orderStatus = 'confirmed';
                        statusNote = `تم تأكيد الطلب نصياً: "${text}"`;
                        
                    } else if (isCancel) {
                        responseText = "❌ تم إلغاء طلبك كما طلبت.\n\n😔 نأسف لعدم تمكننا من خدمتك هذه المرة.\n💡 يمكنك الطلب مرة أخرى في أي وقت.\n\n🤝 نتطلع لخدمتك قريباً!";
                        orderStatus = 'cancelled';
                        statusNote = `تم إلغاء الطلب نصياً: "${text}"`;
                        
                    } else {
                        // رد غير واضح
                        responseText = `🤔 عذراً، لم أفهم ردك: "${text}"\n\n` +
                                      `📝 يرجى الرد بأحد الخيارات التالية:\n\n` +
                                      `✅ للتأكيد: "موافق" أو "نعم" أو "تم"\n` +
                                      `❌ للإلغاء: "إلغاء" أو "لا" أو "رفض"\n\n` +
                                      `🤖 شكراً لصبرك!`;
                        console.log(`❓ رد غير واضح من ${customerPhone}: "${text}"`);
                    }
                    
                    // إرسال الرد
                    await sock.sendMessage(customerJid, { text: responseText });
                    
                    // تحديث حالة الطلب إذا كان واضح
                    if (orderStatus) {
                        const updateResult = await updateOrderStatus(customerPhone, orderStatus, statusNote);
                        if (updateResult.success) {
                            console.log(`✅ تم تحديث الطلب في Easy Order: ${orderStatus}`);
                        } else {
                            console.error(`❌ فشل تحديث Easy Order: ${updateResult.error}`);
                            // يمكن إضافة محاولة أخرى أو تسجيل في قاعدة بيانات محلية
                        }
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

// إعداد Express
const app = express();

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// CORS
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

// Logging
app.use((req, res, next) => {
    console.log(`📡 ${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// Routes
app.get("/", (req, res) => {
    try {
        if (!isWhatsappConnected && qrCodeData) {
            const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>AutoService Bot - QR Code</title>
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
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        color: white;
                        text-align: center;
                        padding: 20px;
                        box-sizing: border-box;
                    }
                    .container { 
                        background: rgba(255,255,255,0.95); 
                        color: #333;
                        padding: 30px; 
                        border-radius: 15px; 
                        box-shadow: 0 8px 25px rgba(0,0,0,0.2); 
                        max-width: 400px;
                        width: 100%;
                    }
                    img { 
                        border: 3px solid #25D366; 
                        border-radius: 10px; 
                        margin: 20px 0; 
                        max-width: 100%;
                        height: auto;
                    }
                    .status { 
                        color: #25D366; 
                        font-weight: bold;
                        font-size: 18px;
                    }
                    .title {
                        background: linear-gradient(45deg, #25D366, #128C7E);
                        -webkit-background-clip: text;
                        -webkit-text-fill-color: transparent;
                        font-size: 24px;
                        font-weight: bold;
                        margin-bottom: 10px;
                    }
                </style>
                <script>
                    setTimeout(() => window.location.reload(), 5000);
                </script>
            </head>
            <body>
                <div class="container">
                    <h1 class="title">🚗 AutoService Bot</h1>
                    <h2>امسح الرمز باستخدام واتساب</h2>
                    <img src="${qrCodeData}" alt="QR Code">
                    <p class="status">🔄 في انتظار المسح...</p>
                    <small>ستتم إعادة تحميل الصفحة تلقائياً خلال 5 ثوان</small>
                </div>
            </body>
            </html>`;
            res.send(html);
            
        } else if (isWhatsappConnected) {
            const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>AutoService Bot - Connected</title>
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
                        background: linear-gradient(135deg, #25D366 0%, #128C7E 100%);
                        color: white; 
                        text-align: center;
                        padding: 20px;
                        box-sizing: border-box;
                    }
                    .container {
                        background: rgba(255,255,255,0.1);
                        padding: 40px;
                        border-radius: 20px;
                        backdrop-filter: blur(10px);
                        border: 1px solid rgba(255,255,255,0.2);
                    }
                    .pulse {
                        animation: pulse 2s infinite;
                    }
                    @keyframes pulse {
                        0% { transform: scale(1); }
                        50% { transform: scale(1.05); }
                        100% { transform: scale(1); }
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1 class="pulse">✅ البوت متصل بنجاح!</h1>
                    <p>🤖 AutoService Bot جاهز ومتصل بواتساب</p>
                    <p>📱 جاهز لاستقبال الطلبات من Easy Order</p>
                    <p>🚗 خدمة عملاء أوتو سيرفس الآلية تعمل الآن</p>
                </div>
            </body>
            </html>`;
            res.send(html);
            
        } else {
            res.json({
                status: "🔄 Starting...",
                connected: false,
                message: "البوت يحاول الاتصال بواتساب...",
                retries: connectionRetries
            });
        }
    } catch (error) {
        console.error('❌ خطأ في الصفحة الرئيسية:', error);
        res.status(500).json({ error: "خطأ في تحميل الصفحة" });
    }
});

app.get("/status", (req, res) => {
    res.json({
        connected: isWhatsappConnected,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        hasQR: !!qrCodeData,
        memory: process.memoryUsage(),
        retries: connectionRetries
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
        
        // استخراج البيانات
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
        
        // صياغة الرسالة الأساسية
        let message = `مرحباً ${customerName} 🌟\n\n` +
                      `شكرًا لاختيارك اوتو سيرفس! يسعدنا إبلاغك بأنه تم استلام طلبك بنجاح.\n\n`;
        
        if (itemsList) {
            message += `🛍️ تفاصيل الطلب:\n${itemsList}\n\n`;
        }
        
        message += `💰 الإجمالي: ${total} ج.م\n` +
                   `📍 العنوان: ${address}\n\n` +
                   `للبدء في تجهيز طلبك وشحنه، يُرجى تأكيد الطلب.