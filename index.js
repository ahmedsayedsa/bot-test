// استيراد المكتبات المطلوبة
const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https"); // إضافة https للـ requests
const http = require("http");   // إضافة http أيضاً

// إضافة crypto polyfill للـ global scope
global.crypto = crypto;
if (crypto.webcrypto) {
    global.crypto.webcrypto = crypto.webcrypto;
}

const makeWASocket = require("@whiskeysockets/baileys").default;
const { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode");

// دالة محسنة لإرسال HTTP requests بدون fetch
function makeHttpRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        try {
            const urlObj = new URL(url);
            const isHttps = urlObj.protocol === 'https:';
            const lib = isHttps ? https : http;
            
            const postData = options.body ? JSON.stringify(options.body) : null;
            
            const requestOptions = {
                hostname: urlObj.hostname,
                port: urlObj.port || (isHttps ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: options.method || 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'AutoService-WhatsApp-Bot/1.0',
                    ...(options.headers || {}),
                    ...(postData && { 'Content-Length': Buffer.byteLength(postData) })
                },
                timeout: 10000 // 10 seconds timeout
            };
            
            const req = lib.request(requestOptions, (res) => {
                let data = '';
                
                res.on('data', (chunk) => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    try {
                        const response = {
                            ok: res.statusCode >= 200 && res.statusCode < 300,
                            status: res.statusCode,
                            statusText: res.statusMessage,
                            json: () => Promise.resolve(JSON.parse(data || '{}')),
                            text: () => Promise.resolve(data)
                        };
                        resolve(response);
                    } catch (parseError) {
                        resolve({
                            ok: res.statusCode >= 200 && res.statusCode < 300,
                            status: res.statusCode,
                            statusText: res.statusMessage,
                            json: () => Promise.reject(parseError),
                            text: () => Promise.resolve(data)
                        });
                    }
                });
            });
            
            req.on('error', (error) => {
                reject(error);
            });
            
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });
            
            if (postData) {
                req.write(postData);
            }
            
            req.end();
        } catch (error) {
            reject(error);
        }
    });
}

// دالة محسنة لتحديث حالة الطلب في Easy Order
async function updateOrderStatus(customerPhone, status, notes = '') {
    try {
        const easyOrderWebhookUrl = process.env.EASYORDER_UPDATE_URL || 'https://your-easyorder-webhook.com/update-order';
        
        // تحقق من صحة الـ URL
        if (!easyOrderWebhookUrl || easyOrderWebhookUrl.includes('your-easyorder-webhook.com')) {
            console.log(`⚠️ لم يتم تكوين URL الـ Easy Order بشكل صحيح`);
            return { success: false, error: 'EASYORDER_UPDATE_URL not configured' };
        }
        
        const updateData = {
            customer_phone: customerPhone,
            status: status,
            notes: notes,
            updated_by: 'whatsapp_bot',
            timestamp: new Date().toISOString()
        };
        
        console.log(`🔄 محاولة تحديث حالة الطلب في Easy Order:`, updateData);
        
        const headers = {
            'Content-Type': 'application/json'
        };
        
        // إضافة Authorization إذا كان متوفراً
        const apiKey = process.env.EASYORDER_API_KEY;
        if (apiKey && apiKey !== '') {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }
        
        const response = await makeHttpRequest(easyOrderWebhookUrl, {
            method: 'POST',
            headers: headers,
            body: updateData
        });
        
        if (response.ok) {
            const result = await response.json();
            console.log(`✅ تم تحديث حالة الطلب في Easy Order بنجاح:`, result);
            return { success: true, data: result };
        } else {
            const errorText = await response.text();
            console.error(`❌ فشل في تحديث Easy Order:`, response.status, errorText);
            return { success: false, error: `HTTP ${response.status}: ${errorText}` };
        }
        
    } catch (error) {
        console.error('❌ خطأ في تحديث حالة الطلب:', error.message);
        
        // تحقق من نوع الخطأ وقدم رسالة مفيدة
        if (error.code === 'ENOTFOUND') {
            return { success: false, error: 'خطأ في الاتصال: عنوان الـ URL غير صحيح' };
        } else if (error.code === 'ECONNREFUSED') {
            return { success: false, error: 'خطأ في الاتصال: الخادم رفض الاتصال' };
        } else if (error.message.includes('timeout')) {
            return { success: false, error: 'انتهت مهلة الاتصال' };
        }
        
        return { success: false, error: error.message };
    }
}

// دالة بديلة للتحديث المحلي (إذا فشل الـ API)
async function saveOrderStatusLocally(customerPhone, status, notes = '') {
    try {
        const logDir = path.join(__dirname, 'orders_log');
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        
        const logFile = path.join(logDir, 'orders.json');
        let orders = [];
        
        // قراءة الطلبات الموجودة
        if (fs.existsSync(logFile)) {
            try {
                const data = fs.readFileSync(logFile, 'utf8');
                orders = JSON.parse(data);
            } catch (parseError) {
                console.warn('⚠️ خطأ في قراءة ملف الطلبات، إنشاء ملف جديد');
                orders = [];
            }
        }
        
        // إضافة الطلب الجديد
        const orderUpdate = {
            customer_phone: customerPhone,
            status: status,
            notes: notes,
            updated_by: 'whatsapp_bot',
            timestamp: new Date().toISOString()
        };
        
        orders.push(orderUpdate);
        
        // حفظ الطلبات (الاحتفاظ بآخر 100 طلب فقط)
        if (orders.length > 100) {
            orders = orders.slice(-100);
        }
        
        fs.writeFileSync(logFile, JSON.stringify(orders, null, 2));
        console.log(`📁 تم حفظ الطلب محلياً: ${status} - ${customerPhone}`);
        
        return { success: true, saved_locally: true };
        
    } catch (error) {
        console.error('❌ خطأ في الحفظ المحلي:', error.message);
        return { success: false, error: error.message };
    }
}

let isWhatsappConnected = false;
let qrCodeData = null;
let sock = null;

// دالة حفظ الاتصال بشكل دائم
async function getAuthDir() {
    const authDir = path.join(__dirname, 'whatsapp_session');
    if (!fs.existsSync(authDir)) {
        fs.mkdirSync(authDir, { recursive: true });
    }
    return authDir;
}

async function startBot() {
    try {
        console.log("🚀 بدء تشغيل البوت...");
        
        const authDir = await getAuthDir();
        const { state, saveCreds } = await useMultiFileAuthState(authDir);
        const { version } = await fetchLatestBaileysVersion();
        
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
                } catch (qrError) {
                    console.error('❌ خطأ في إنشاء QR:', qrError);
                }
            }

            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log('❌ الاتصال مقطوع. إعادة الاتصال:', shouldReconnect);
                
                isWhatsappConnected = false;
                qrCodeData = null;
                
                if (shouldReconnect) {
                    setTimeout(() => startBot(), 5000);
                } else {
                    console.log('❌ تم تسجيل الخروج، حذف الجلسة...');
                    try {
                        if (fs.existsSync(authDir)) {
                            fs.rmSync(authDir, { recursive: true, force: true });
                        }
                    } catch (cleanupError) {
                        console.error('❌ خطأ في حذف الجلسة:', cleanupError);
                    }
                    setTimeout(() => startBot(), 5000);
                }
                
            } else if (connection === 'open') {
                console.log('✅ البوت متصل بواتساب بنجاح!');
                isWhatsappConnected = true;
                qrCodeData = null;
            }
        });

        // معالجة الرسائل الواردة
        sock.ev.on("messages.upsert", async (m) => {
            try {
                const message = m.messages[0];
                if (!message.message || message.key.fromMe) return;
                
                const customerJid = message.key.remoteJid;
                const customerPhone = customerJid.replace('@s.whatsapp.net', '');
                
                // معالجة الاستفتاء
                const pollUpdate = message.message.pollUpdateMessage;
                if (pollUpdate) {
                    const vote = pollUpdate.vote;
                    if (vote && vote.selectedOptions && vote.selectedOptions.length > 0) {
                        const selectedOption = vote.selectedOptions[0];
                        console.log(`🗳️ استفتاء من ${customerPhone}: خيار ${selectedOption}`);
                        
                        let responseText = "";
                        let orderStatus = "";
                        
                        if (selectedOption === 0) {
                            responseText = "✅ تم تأكيد طلبك بنجاح!\n🚚 سيتم التجهيز خلال 1-2 يوم عمل.\n🙏 شكراً لثقتك في اوتو سيرفس!";
                            orderStatus = 'confirmed';
                        } else if (selectedOption === 1) {
                            responseText = "❌ تم إلغاء طلبك.\n😔 نتمنى خدمتك مرة أخرى قريباً.";
                            orderStatus = 'cancelled';
                        }
                        
                        if (responseText) {
                            await sock.sendMessage(customerJid, { text: responseText });
                            
                            // محاولة التحديث مع الـ fallback
                            const updateResult = await updateOrderStatus(customerPhone, orderStatus, 'تم الرد عبر الاستفتاء');
                            if (!updateResult.success) {
                                console.log('🔄 محاولة الحفظ المحلي...');
                                await saveOrderStatusLocally(customerPhone, orderStatus, 'تم الرد عبر الاستفتاء');
                            }
                            
                            console.log(`✅ تم تحديث الطلب: ${orderStatus}`);
                        }
                        return;
                    }
                }
                
                // معالجة الأزرار
                const buttonResponse = message.message.buttonsResponseMessage ||
                                     message.message.listResponseMessage ||
                                     message.message.templateButtonReplyMessage;
                
                let buttonId = null;
                if (buttonResponse) {
                    if (message.message.buttonsResponseMessage) {
                        buttonId = message.message.buttonsResponseMessage.selectedButtonId;
                    } else if (message.message.listResponseMessage) {
                        buttonId = message.message.listResponseMessage.singleSelectReply.selectedRowId;
                    } else if (message.message.templateButtonReplyMessage) {
                        buttonId = message.message.templateButtonReplyMessage.selectedId;
                    }
                    
                    console.log(`🔲 زر من ${customerPhone}: ${buttonId}`);
                    
                    let responseText = "";
                    let orderStatus = "";
                    
                    if (buttonId === 'confirm_order') {
                        responseText = "✅ تم تأكيد طلبك بنجاح!\n🚚 سيتم التجهيز خلال 1-2 يوم عمل.\n🙏 شكراً لثقتك في اوتو سيرفس!";
                        orderStatus = 'confirmed';
                    } else if (buttonId === 'cancel_order') {
                        responseText = "❌ تم إلغاء طلبك.\n😔 نتمنى خدمتك مرة أخرى قريباً.";
                        orderStatus = 'cancelled';
                    }
                    
                    if (responseText) {
                        await sock.sendMessage(customerJid, { text: responseText });
                        
                        // محاولة التحديث مع الـ fallback
                        const updateResult = await updateOrderStatus(customerPhone, orderStatus, 'تم الرد عبر الأزرار');
                        if (!updateResult.success) {
                            console.log('🔄 محاولة الحفظ المحلي...');
                            await saveOrderStatusLocally(customerPhone, orderStatus, 'تم الرد عبر الأزرار');
                        }
                        
                        console.log(`✅ تم تحديث الطلب: ${orderStatus}`);
                    }
                    return;
                }
                
                // معالجة النص
                const text = message.message.conversation || message.message.extendedTextMessage?.text || "";
                
                if (text.trim()) {
                    const lowerText = text.toLowerCase().trim();
                    const confirmWords = ['موافق', 'تم', 'نعم', 'yes', 'ok', 'أوافق', 'تمام', 'حاضر'];
                    const cancelWords = ['إلغاء', 'الغاء', 'لا', 'no', 'رفض', 'مش موافق'];
                    
                    const isConfirm = confirmWords.some(word => lowerText.includes(word));
                    const isCancel = cancelWords.some(word => lowerText.includes(word));
                    
                    console.log(`📝 نص من ${customerPhone}: "${text}" | تأكيد: ${isConfirm} | إلغاء: ${isCancel}`);
                    
                    let responseText = "";
                    let orderStatus = "";
                    
                    if (isConfirm) {
                        responseText = "✅ تم تأكيد طلبك بنجاح!\n🚚 سيتم التجهيز خلال 1-2 يوم عمل.\n🙏 شكراً لثقتك في اوتو سيرفس!";
                        orderStatus = 'confirmed';
                    } else if (isCancel) {
                        responseText = "❌ تم إلغاء طلبك.\n😔 نتمنى خدمتك مرة أخرى قريباً.";
                        orderStatus = 'cancelled';
                    } else {
                        responseText = `🤔 عذراً، لم أفهم: "${text}"\n📝 اكتب "موافق" للتأكيد أو "إلغاء" للرفض`;
                    }
                    
                    await sock.sendMessage(customerJid, { text: responseText });
                    
                    if (orderStatus) {
                        // محاولة التحديث مع الـ fallback
                        const updateResult = await updateOrderStatus(customerPhone, orderStatus, `رد نصي: "${text}"`);
                        if (updateResult.success) {
                            console.log(`✅ تم تحديث Easy Order: ${orderStatus}`);
                        } else {
                            console.log(`⚠️ فشل تحديث Easy Order: ${updateResult.error}`);
                            console.log('🔄 محاولة الحفظ المحلي...');
                            const localResult = await saveOrderStatusLocally(customerPhone, orderStatus, `رد نصي: "${text}"`);
                            if (localResult.success) {
                                console.log('✅ تم الحفظ محلياً');
                            }
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

// Express Setup
const app = express();
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

// Routes
app.get("/", (req, res) => {
    if (!isWhatsappConnected && qrCodeData) {
        const html = `<!DOCTYPE html>
<html><head><title>AutoService Bot - QR</title><meta charset="utf-8">
<style>body{font-family:Arial;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#25D366;color:white;text-align:center;padding:20px}
.container{background:rgba(255,255,255,0.95);color:#333;padding:30px;border-radius:15px;box-shadow:0 8px 25px rgba(0,0,0,0.2);max-width:400px;width:100%}
img{border:3px solid #25D366;border-radius:10px;margin:20px 0;max-width:100%;height:auto}</style>
<script>setTimeout(() => window.location.reload(), 5000);</script>
</head><body><div class="container"><h1>🚗 AutoService Bot</h1><h2>امسح الرمز بواتساب</h2>
<img src="${qrCodeData}" alt="QR Code"><p>🔄 في انتظار المسح...</p></div></body></html>`;
        res.send(html);
    } else if (isWhatsappConnected) {
        const html = `<!DOCTYPE html>
<html><head><title>AutoService Bot - Connected</title><meta charset="utf-8">
<style>body{font-family:Arial;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#25D366;color:white;text-align:center;padding:20px}</style>
</head><body><h1>✅ البوت متصل بنجاح!</h1><p>🤖 جاهز لاستقبال الطلبات</p></body></html>`;
        res.send(html);
    } else {
        res.json({status: "🔄 Starting...", connected: false});
    }
});

app.get("/status", (req, res) => {
    res.json({
        connected: isWhatsappConnected,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        hasQR: !!qrCodeData
    });
});

// عرض الطلبات المحفوظة محلياً
app.get("/orders", (req, res) => {
    try {
        const logFile = path.join(__dirname, 'orders_log', 'orders.json');
        if (fs.existsSync(logFile)) {
            const data = fs.readFileSync(logFile, 'utf8');
            const orders = JSON.parse(data);
            res.json({ success: true, orders: orders });
        } else {
            res.json({ success: true, orders: [], message: 'لا توجد طلبات محفوظة' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Webhook رئيسي - مُحسَّن لإرسال رسالة واحدة فقط
app.post("/webhook", async (req, res) => {
    console.log("📩 WEBHOOK: طلب جديد من Easy Order");
    console.log("البيانات:", JSON.stringify(req.body, null, 2));

    if (!isWhatsappConnected) {
        return res.status(503).json({error: "البوت غير متصل"});
    }

    try {
        const data = req.body;
        
        const customerName = data.full_name || data.customer_name || data.name || "عميلنا الكريم";
        const customerPhone = data.phone || data.customer_phone || data.mobile || null;
        const total = data.total_cost || data.total || data.totalAmount || "غير محدد";
        const address = data.address || data.shipping_address || "غير محدد";
        const items = data.cart_items || data.items || data.products || [];
        
        if (!customerPhone) {
            return res.status(400).json({error: "لا يوجد رقم هاتف"});
        }

        // تنسيق المنتجات
        let itemsList = "";
        if (items && Array.isArray(items) && items.length > 0) {
            itemsList = items.map((item, index) => {
                const name = item.product?.name || item.name || item.title || `منتج ${index + 1}`;
                const qty = item.quantity || item.qty || 1;
                return `- ${name}: ${qty} قطعة`;
            }).join("\n");
        }
        
        // الرسالة الموحدة
        let message = `مرحباً ${customerName} 🌟\n\n` +
                      `تم استلام طلبك من اوتو سيرفس بنجاح!\n\n`;
        
        if (itemsList) {
            message += `🛍️ طلبك:\n${itemsList}\n\n`;
        }
        
        message += `💰 المجموع: ${total} ج.م\n` +
                   `📍 العنوان: ${address}\n\n` +
                   `للموافقة على الطلب وبدء التجهيز، اختر من الأسفل:`;

        // تنسيق الرقم
        let formattedNumber = customerPhone.toString().replace(/^0/, "20") + "@s.whatsapp.net";
        
        console.log(`📞 إرسال لـ: ${formattedNumber}`);

        // محاولة إرسال استفتاء (الأفضل)
        let messageSent = false;
        
        try {
            await sock.sendMessage(formattedNumber, { text: message });
            
            await sock.sendMessage(formattedNumber, { 
                poll: {
                    name: 'قرار الطلب:',
                    options: ['✅ موافق - تأكيد الطلب', '❌ رفض - إلغاء الطلب'],
                    selectableOptionsCount: 1
                }
            });
            
            console.log('✅ تم إرسال الرسالة + الاستفتاء');
            messageSent = true;
            
        } catch (pollError) {
            console.log('❌ فشل الاستفتاء، محاولة الأزرار...');
            
            try {
                const styledMessage = message + 
                    '\n\n═══════════════════════\n' +
                    '🟢 للموافقة: اكتب "موافق" أو "تم"\n' +
                    '🔴 للرفض: اكتب "إلغاء" أو "لا"\n' +
                    '═══════════════════════';
                
                await sock.sendMessage(formattedNumber, { text: styledMessage });
                console.log('✅ تم إرسال رسالة منسقة');
                messageSent = true;
                
            } catch (textError) {
                console.error('❌ فشل إرسال الرسالة:', textError);
            }
        }
        
        if (messageSent) {
            res.json({ 
                success: true, 
                message: "تم إرسال الطلب للعميل",
                sentTo: customerPhone,
                customerName: customerName
            });
        } else {
            res.status(500).json({error: "فشل في إرسال الرسالة"});
        }

    } catch (err) {
        console.error("❌ خطأ في Webhook:", err);
        res.status(500).json({error: "خطأ في معالجة الطلب"});
    }
});

// Routes إضافية
app.post("/test-send", async (req, res) => {
    if (!isWhatsappConnected) {
        return res.status(503).json({error: "البوت غير متصل"});
    }
    
    try {
        const { phone, message } = req.body;
        let formattedNumber = phone.toString().replace(/^0/, "20") + "@s.whatsapp.net";
        await sock.sendMessage(formattedNumber, { text: message });
        res.json({success: true, sentTo: formattedNumber});
    } catch (error) {
        res.status(500).json({error: error.message});
    }
});

app.get("/health", (req, res) => {
    res.json({status: "OK", connected: isWhatsappConnected, uptime: process.uptime()});
});

app.post("/restart", (req, res) => {
    console.log("🔄 إعادة تشغيل البوت...");
    isWhatsappConnected = false;
    qrCodeData = null;
    if (sock) sock.end();
    setTimeout(() => startBot(), 2000);
    res.json({success: true});
});

// Error Handling
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
});

// Start Server
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`🚀 Server running on http://${HOST}:${PORT}`);
    console.log(`📱 Easy Order URL: ${process.env.EASYORDER_UPDATE