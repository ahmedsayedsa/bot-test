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

// دالة لتحديث حالة الطلب في Easy Order
async function updateOrderStatus(customerPhone, status, notes = '') {
    try {
        // هنا تضع رابط Easy Order API لتحديث الطلبات
        const easyOrderWebhookUrl = process.env.EASYORDER_UPDATE_URL || 'https://your-easyorder-webhook.com/update-order';
        
        const updateData = {
            customer_phone: customerPhone,
            status: status, // 'confirmed', 'cancelled', 'processing', 'shipped', 'delivered'
            notes: notes,
            updated_by: 'whatsapp_bot',
            timestamp: new Date().toISOString()
        };
        
        console.log(`🔄 محاولة تحديث حالة الطلب في Easy Order:`, updateData);
        
        const response = await fetch(easyOrderWebhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.EASYORDER_API_KEY || ''}`, // إذا كان فيه API key
            },
            body: JSON.stringify(updateData)
        });
        
        if (response.ok) {
            const result = await response.json();
            console.log(`✅ تم تحديث حالة الطلب في Easy Order بنجاح:`, result);
            return true;
        } else {
            console.error(`❌ فشل في تحديث Easy Order:`, response.status, await response.text());
            return false;
        }
        
    } catch (error) {
        console.error('❌ خطأ في تحديث حالة الطلب:', error);
        return false;
    }
}

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

        // التعامل مع الرسائل الواردة والأزرار
        sock.ev.on("messages.upsert", async (m) => {
            try {
                const message = m.messages[0];
                if (!message.message || message.key.fromMe) return;
                
                const text = message.message.conversation || 
                           message.message.extendedTextMessage?.text || "";
                
                // معالجة Poll Votes (إجابات الاستفتاء)  
                const pollUpdate = message.message.pollUpdateMessage;
                const pollCreation = message.message.pollCreationMessage;
                
                if (pollUpdate) {
                    try {
                        // استخراج إجابة الاستفتاء
                        const vote = pollUpdate.vote;
                        if (vote && vote.selectedOptions && vote.selectedOptions.length > 0) {
                            const selectedOption = vote.selectedOptions[0];
                            const customerPhone = message.key.remoteJid.replace('@s.whatsapp.net', '');
                            
                            console.log(`🗳️ استفتاء: العميل ${customerPhone} اختار: ${selectedOption}`);
                            
                            if (selectedOption === 0) { // ✅ تأكيد الطلب
                                await sock.sendMessage(message.key.remoteJid, { 
                                    text: "✅ شكراً لك! تم تأكيد طلبك بنجاح من خلال الاستفتاء!\n\n🚚 سيتم تجهيز طلبك والتواصل معك قريباً.\n\n🙏 شكراً لثقتك في اوتو سيرفس!" 
                                });
                                await updateOrderStatus(customerPhone, 'confirmed', 'تم تأكيد الطلب عبر الاستفتاء');
                                
                            } else if (selectedOption === 1) { // ❌ إلغاء الطلب  
                                await sock.sendMessage(message.key.remoteJid, { 
                                    text: "❌ تم إلغاء طلبك بناءً على اختيارك في الاستفتاء.\n\n😔 نتمنى خدمتك في المستقبل!\n\n💡 يمكنك الطلب مرة أخرى في أي وقت." 
                                });
                                await updateOrderStatus(customerPhone, 'cancelled', 'تم إلغاء الطلب عبر الاستفتاء');
                            }
                            return; // انتهى من معالجة الاستفتاء
                        }
                    } catch (pollError) {
                        console.error('❌ خطأ في معالجة الاستفتاء:', pollError);
                    }
                }
                
                // معالجة الرد على جميع أنواع الأزرار والقوائم
                const buttonResponseMessage = message.message.buttonsResponseMessage;
                const listResponseMessage = message.message.listResponseMessage;
                const templateButtonReply = message.message.templateButtonReplyMessage;
                const interactiveResponseMessage = message.message.interactiveResponseMessage;
                
                console.log(`📨 رسالة واردة من ${message.key.remoteJid}: ${text}`);
                
                let buttonId = null;
                
                // استخراج معرف الزر من أي نوع من الردود
                if (buttonResponseMessage) {
                    buttonId = buttonResponseMessage.selectedButtonId;
                    console.log(`🔲 Button Response: ${buttonId}`);
                } else if (listResponseMessage) {
                    buttonId = listResponseMessage.singleSelectReply.selectedRowId;
                    console.log(`📋 List Response: ${buttonId}`);
                } else if (templateButtonReply) {
                    buttonId = templateButtonReply.selectedId;
                    console.log(`🎯 Template Response: ${buttonId}`);
                } else if (interactiveResponseMessage) {
                    const nativeFlowResponse = interactiveResponseMessage.nativeFlowResponseMessage;
                    if (nativeFlowResponse && nativeFlowResponse.paramsJson) {
                        try {
                            const params = JSON.parse(nativeFlowResponse.paramsJson);
                            buttonId = params.id;
                            console.log(`🔄 Interactive Response: ${buttonId}`);
                        } catch (e) {
                            console.log(`❌ خطأ في تحليل Interactive Response`);
                        }
                    }
                }
                
                // معالجة الرد على الأزرار
                if (buttonId) {
                    const customerPhone = message.key.remoteJid.replace('@s.whatsapp.net', '');
                    
                    console.log(`🔲 تم الضغط على: ${buttonId} من العميل: ${customerPhone}`);
                    
                    if (buttonId === 'confirm_order') {
                        // تأكيد الطلب
                        await sock.sendMessage(message.key.remoteJid, { 
                            text: "✅ تم تأكيد طلبك بنجاح!\n\n🚚 سيتم تجهيز طلبك والتواصل معك لترتيب موعد التوصيل.\n\n⏰ مدة التجهيز المتوقعة: 1-2 يوم عمل\n\n🙏 شكراً لثقتك في اوتو سيرفس!" 
                        });
                        
                        // تحديث حالة الطلب في Easy Order
                        await updateOrderStatus(customerPhone, 'confirmed', 'تم تأكيد الطلب من العميل');
                        console.log("✅ تم تأكيد الطلب وتحديث الحالة");
                        
                    } else if (buttonId === 'cancel_order') {
                        // إلغاء الطلب
                        await sock.sendMessage(message.key.remoteJid, { 
                            text: "❌ تم إلغاء طلبك بناءً على طلبك.\n\n😔 نأسف لعدم تمكننا من خدمتك هذه المرة.\n\n💡 يمكنك طلب منتجات أخرى في أي وقت من خلال موقعنا.\n\nشكراً لك!" 
                        });
                        
                        // تحديث حالة الطلب في Easy Order
                        await updateOrderStatus(customerPhone, 'cancelled', 'تم إلغاء الطلب من قبل العميل');
                        console.log("❌ تم إلغاء الطلب وتحديث الحالة");
                    }
                }
                
                // معالجة الردود النصية (مع كلمات أكثر تنوعاً)
                else if (text && text.trim()) {
                    const lowerText = text.toLowerCase().trim();
                    const customerPhone = message.key.remoteJid.replace('@s.whatsapp.net', '');
                    
                    // كلمات التأكيد
                    const confirmWords = ['موافق', 'تم', 'نعم', 'yes', 'ok', 'أوافق', 'اوافق', 'موافقه', 'تمام', 'اوكي', 'حاضر', 'ماشي', 'صح'];
                    // كلمات الإلغاء
                    const cancelWords = ['إلغاء', 'الغاء', 'لا', 'no', 'رفض', 'مش موافق', 'لأ', 'لاء', 'مش عايز', 'مش عاوز', 'cancel'];
                    
                    const isConfirm = confirmWords.some(word => lowerText.includes(word));
                    const isCancel = cancelWords.some(word => lowerText.includes(word));
                    
                    if (isConfirm) {
                        await sock.sendMessage(message.key.remoteJid, { 
                            text: "✅ ممتاز! تم تأكيد طلبك بنجاح!\n\n🚚 سيتم تجهيز طلبك خلال 1-2 يوم عمل.\n📞 سنتواصل معك لترتيب موعد التوصيل.\n\n🙏 شكراً لثقتك في اوتو سيرفس!" 
                        });
                        
                        await updateOrderStatus(customerPhone, 'confirmed', `تم تأكيد الطلب نصياً: "${text}"`);
                        console.log(`✅ تم تأكيد الطلب نصياً: "${text}"`);
                        
                    } else if (isCancel) {
                        await sock.sendMessage(message.key.remoteJid, { 
                            text: "❌ تم إلغاء طلبك كما طلبت.\n\n😔 نأسف لعدم تمكننا من خدمتك هذه المرة.\n💡 يمكنك الطلب مرة أخرى في أي وقت.\n\n🤝 نتطلع لخدمتك قريباً!" 
                        });
                        
                        await updateOrderStatus(customerPhone, 'cancelled', `تم إلغاء الطلب نصياً: "${text}"`);
                        console.log(`❌ تم إلغاء الطلب نصياً: "${text}"`);
                        
                    } else {
                        // رسالة غير واضحة - طلب توضيح
                        await sock.sendMessage(message.key.remoteJid, { 
                            text: `🤔 عذراً، لم أفهم ردك: "${text}"\n\n` +
                                  `📝 يرجى الرد بأحد الخيارات التالية:\n\n` +
                                  `✅ للتأكيد: "موافق" أو "نعم" أو "تم"\n` +
                                  `❌ للإلغاء: "إلغاء" أو "لا" أو "رفض"\n\n` +
                                  `🤖 شكراً لصبرك!`
                        });
                        console.log(`❓ رد غير واضح من ${customerPhone}: "${text}"`);
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
        console.log("📤 محاولة إرسال الرسالة مع الأزرار...");

        // تجربة Quick Reply Buttons (الأكثر توافقاً)
        let buttonsSent = false;

        // الطريقة الأولى: Quick Reply مع Baileys الحديث
        try {
            const quickReplyMessage = {
                text: message,
                contextInfo: {
                    mentionedJid: [],
                    quotedMessage: null,
                    isForwarded: false
                },
                buttons: [
                    {
                        type: 'replyButton',
                        reply: {
                            id: 'confirm_order',
                            title: '✅ تأكيد الطلب'
                        }
                    },
                    {
                        type: 'replyButton', 
                        reply: {
                            id: 'cancel_order',
                            title: '❌ إلغاء الطلب'
                        }
                    }
                ],
                headerType: 'TEXT',
                contentText: message,
                footerText: '🤖 اوتو سيرفس - اضغط أحد الأزرار'
            };
            
            await sock.sendMessage(formattedNumber, { buttonsMessage: quickReplyMessage });
            console.log(`✅ تم إرسال Quick Reply Message بنجاح`);
            buttonsSent = true;
            
        } catch (quickReplyError) {
            console.log(`❌ فشل Quick Reply:`, quickReplyError.message);
        }

        // الطريقة الثانية: Interactive List (أكثر موثوقية)
        if (!buttonsSent) {
            try {
                const listMessage = {
                    text: message + '\n\n👇 اضغط على "خيارات الطلب" أسفل لاختيار ما تريد',
                    buttonText: 'خيارات الطلب',
                    sections: [
                        {
                            title: '📋 اختر العملية المطلوبة',
                            rows: [
                                {
                                    title: '✅ تأكيد الطلب',
                                    description: 'أوافق على الطلب وأريد المتابعة',
                                    rowId: 'confirm_order'
                                },
                                {
                                    title: '❌ إلغاء الطلب',
                                    description: 'أريد إلغاء هذا الطلب نهائياً',
                                    rowId: 'cancel_order'
                                }
                            ]
                        }
                    ],
                    listType: 'SINGLE_SELECT'
                };
                
                await sock.sendMessage(formattedNumber, { listMessage: listMessage });
                console.log(`✅ تم إرسال Interactive List بنجاح`);
                buttonsSent = true;
                
            } catch (listError) {
                console.log(`❌ فشل Interactive List:`, listError.message);
            }
        }

        // الطريقة الثالثة: Location Request مع أزرار مخفية (تجريبية)
        if (!buttonsSent) {
            try {
                // إرسال رسالة عادية أولاً
                await sock.sendMessage(formattedNumber, { text: message });
                
                // ثم إرسال رسالة منفصلة مع خيارات سريعة
                const quickOptions = {
                    text: '🎯 اختر رد سريع:\n\n' +
                          '🟢 اكتب: نعم\n' +
                          '🔴 اكتب: لا\n\n' +
                          'أو اختر من الأزرار أدناه ⬇️',
                    templateButtons: [
                        {
                            index: 1,
                            quickReplyButton: {
                                displayText: '✅ نعم، أوافق',
                                id: 'confirm_order'
                            }
                        },
                        {
                            index: 2,
                            quickReplyButton: {
                                displayText: '❌ لا، إلغاء',
                                id: 'cancel_order'  
                            }
                        }
                    ]
                };
                
                await sock.sendMessage(formattedNumber, { templateMessage: { hydratedTemplate: quickOptions } });
                console.log(`✅ تم إرسال Template Buttons بنجاح`);
                buttonsSent = true;
                
            } catch (templateError) {
                console.log(`❌ فشل Template Buttons:`, templateError.message);
            }
        }

        // الطريقة الرابعة: Poll Message (استفتاء)
        if (!buttonsSent) {
            try {
                const pollMessage = {
                    name: 'قرار الطلب - اختر إجابة واحدة',
                    options: ['✅ تأكيد الطلب', '❌ إلغاء الطلب'],
                    selectableOptionsCount: 1
                };
                
                // إرسال الرسالة الأساسية أولاً
                await sock.sendMessage(formattedNumber, { text: message });
                
                // ثم إرسال الاستفتاء
                await sock.sendMessage(formattedNumber, { 
                    poll: pollMessage 
                });
                console.log(`✅ تم إرسال Poll Message بنجاح`);
                buttonsSent = true;
                
            } catch (pollError) {
                console.log(`❌ فشل Poll Message:`, pollError.message);
            }
        }

        // الطريقة الأخيرة: رسالة نصية منسقة مع Emojis
        if (!buttonsSent) {
            console.log(`⚠️ جميع الأزرار فشلت، سنرسل رسالة منسقة بطريقة جذابة`);
            
            const styledMessage = message + 
                '\n\n' +
                '═════════════════════════════\n' +
                '          🎯 خيارات الطلب          \n' +
                '═════════════════════════════\n\n' +
                '🟢 للتأكيد والموافقة:\n' +
                '   📱 اكتب: "موافق" أو "نعم" أو "تم"\n\n' +
                '🔴 للإلغاء والرفض:\n' +
                '   📱 اكتب: "إلغاء" أو "لا" أو "رفض"\n\n' +
                '═════════════════════════════\n' +
                '🤖 رد تلقائي من اوتو سيرفس\n' +
                '⚡ الرد السريع يسرّع المعالجة';
            
            await sock.sendMessage(formattedNumber, { text: styledMessage });
            console.log(`✅ تم إرسال رسالة منسقة بطريقة جذابة`);
        }

        // تحديث الاستجابة لتتضمن معلومات الطلب
        const orderData = {
            customer_phone: customerPhone,
            customer_name: customerName,
            total: total,
            items: items.length,
            timestamp: new Date().toISOString()
        };
        
        // حفظ بيانات الطلب مؤقتاً (للربط مع الردود)
        global.pendingOrders = global.pendingOrders || new Map();
        global.pendingOrders.set(customerPhone, orderData);

        console.log(`✅ تم إرسال الطلب للعميل بنجاح على ${formattedNumber}`);
        
        res.json({ 
            success: true, 
            message: "تم إرسال الرسالة بنجاح",
            sentTo: customerPhone,
            customerName: customerName,
            timestamp: new Date().toISOString(),
            hasButtons: true
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

// Route لاستقبال updates من Easy Order (إذا احتجت تحديث حالة طلب من الإدارة)
app.post("/update-order-status", async (req, res) => {
    try {
        const { customer_phone, status, message } = req.body;
        
        if (!customer_phone || !status) {
            return res.status(400).json({ error: "مطلوب رقم العميل وحالة الطلب" });
        }
        
        if (!isWhatsappConnected) {
            return res.status(503).json({ error: "البوت غير متصل بواتساب" });
        }
        
        let formattedNumber = customer_phone.toString().replace(/^0/, "20") + "@s.whatsapp.net";
        
        let statusMessage = "";
        switch (status) {
            case 'processing':
                statusMessage = "🔄 طلبك قيد التجهيز الآن!\n\nسيتم التواصل معك قريباً لتأكيد موعد التوصيل.\n\n⏰ مدة التجهيز المتوقعة: 1-2 يوم عمل";
                break;
            case 'shipped':
                statusMessage = "🚚 تم شحن طلبك!\n\nسيصلك خلال 24-48 ساعة.\n\n📞 سيتواصل معك المندوب قبل الوصول.";
                break;
            case 'delivered':
                statusMessage = "✅ تم توصيل طلبك بنجاح!\n\n🙏 شكراً لاختيارك اوتو سيرفس.\n\n⭐ نأمل أن تشاركنا تقييمك للخدمة.";
                break;
            default:
                statusMessage = message || `تحديث حالة الطلب: ${status}`;
        }
        
        await sock.sendMessage(formattedNumber, { text: statusMessage });
        
        res.json({ 
            success: true, 
            message: "تم إرسال تحديث الحالة للعميل",
            status: status,
            sentTo: customer_phone
        });
        
    } catch (error) {
        console.error('❌ خطأ في تحديث حالة الطلب:', error);
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