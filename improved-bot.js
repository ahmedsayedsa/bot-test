// A more streamlined and robust WhatsApp bot for Easy Order
const express = require("express");
const fs = require("fs");
const crypto = require("crypto");
const axios = require("axios");
const sqlite3 = require('sqlite3').verbose(); 

require('dotenv').config();

// Polyfill crypto for older Node.js versions
global.crypto = crypto;
if (crypto.webcrypto) {
    global.crypto.webcrypto = crypto.webcrypto;
}

const makeWASocket = require("@whiskeysockets/baileys").default;
const { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode");

// Import the EasyOrderAPI class for cleaner code
const EasyOrderAPI = require('./easyorder-api');

// Environment variables
const PORT = process.env.PORT || 3000;
const EASY_ORDER_API_URL = process.env.EASY_ORDER_API_URL || "https://your-easyorder-domain.com/api";
const EASY_ORDER_API_KEY = process.env.EASY_ORDER_API_KEY || "your-api-key";

// Bot state variables
let isWhatsappConnected = false;
let qrCodeData = null;
let sock = null;
let connectionRetries = 0;
const MAX_RETRIES = 5;

// Instantiate the Easy Order API handler
const easyOrderApi = new EasyOrderAPI({
    baseURL: EASY_ORDER_API_URL,
    apiKey: EASY_ORDER_API_KEY
});

// Temporary storage for orders
const pendingOrders = new Map();
const orderTimeouts = new Map();

// New: Database handler
let db;

function initDatabase() {
    return new Promise((resolve, reject) => {
        db = new sqlite3.Database('./customers.db', (err) => {
            if (err) {
                console.error('❌ Error connecting to database:', err.message);
                reject(err);
            } else {
                console.log('✅ Connected to the customers database.');
                db.run(`CREATE TABLE IF NOT EXISTS customers (
                    phone TEXT PRIMARY KEY,
                    name TEXT,
                    first_contact TEXT
                )`, (tableErr) => {
                    if (tableErr) {
                        console.error('❌ Error creating customers table:', tableErr.message);
                        reject(tableErr);
                    } else {
                        console.log('✅ Customers table is ready.');
                        resolve();
                    }
                });
            }
        });
    });
}

function logCustomer(phone, name) {
    db.get(`SELECT phone FROM customers WHERE phone = ?`, [phone], (err, row) => {
        if (err) {
            console.error('❌ Error checking for customer:', err.message);
            return;
        }
        if (!row) {
            db.run(`INSERT INTO customers (phone, name, first_contact) VALUES (?, ?, ?)`, 
                [phone, name, new Date().toISOString()], 
                (insertErr) => {
                    if (insertErr) {
                        console.error('❌ Error saving new customer:', insertErr.message);
                    } else {
                        console.log(`✅ New customer logged: ${name} (${phone})`);
                    }
                }
            );
        } else {
            console.log(`ℹ️ Customer already exists: ${name} (${phone})`);
        }
    });
}

// Helper functions
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
    if (formatted.startsWith('00')) {
        formatted = formatted.substring(2);
    } else if (formatted.startsWith('0') && formatted.length === 11) {
        formatted = '2' + formatted;
    } else if (formatted.length === 10 && !formatted.startsWith('1')) {
        formatted = '20' + formatted;
    }
    return formatted + '@s.whatsapp.net';
}

function generateOrderMessage(orderData) {
    const { orderId, customerName, items, total, address } = orderData;
    let message = `🌟 أهلاً وسهلاً ${customerName}\n\n` +
                  `شكرًا لاختيارك اوتو سيرفس! تم استلام طلبك بنجاح 🎉\n\n` +
                  `🆔 رقم الطلب: #${orderId.toString().slice(-6)}\n\n`;

    if (items && Array.isArray(items) && items.length > 0) {
        const itemsList = items.map((item, index) => {
            const name = item.product?.name || item.name || item.title || `منتج ${index + 1}`;
            const qty = item.quantity || item.qty || item.pivot?.quantity || 1;
            let price = item.sale_price || item.price || item.unit_price || item.product?.sale_price || item.product?.price || 0;
            let line = `• ${name}`;
            if (qty > 1) line += `: ${qty} قطعة`;
            if (price) line += ` (${price} ج.م${qty > 1 ? ' للقطعة' : ''})`;
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

// Bot startup function
async function startBot() {
    try {
        console.log("🚀 Starting the bot...");

        await initDatabase();

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
            console.log(`🔗 Connection status: ${connection}`);

            if (qr) {
                try {
                    qrCodeData = await qrcode.toDataURL(qr);
                    console.log('📡 New QR code generated');
                    fs.writeFileSync('qr.txt', qr);
                } catch (qrError) {
                    console.error('❌ Error generating QR:', qrError);
                }
            }

            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log('❌ Disconnected:', lastDisconnect?.error, 'Reconnecting:', shouldReconnect);
                isWhatsappConnected = false;
                if (shouldReconnect && connectionRetries < MAX_RETRIES) {
                    connectionRetries++;
                    console.log(`🔄 Attempting to reconnect ${connectionRetries}/${MAX_RETRIES}`);
                    setTimeout(() => startBot(), 10000 * connectionRetries);
                } else if (lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut) {
                    console.log('❌ New login required');
                    try {
                        if (fs.existsSync("auth_info")) {
                            fs.rmSync("auth_info", { recursive: true, force: true });
                        }
                    } catch (cleanupError) {
                        console.error('❌ Error deleting auth_info:', cleanupError);
                    }
                    connectionRetries = 0;
                    setTimeout(() => startBot(), 5000);
                } else {
                    console.log('❌ Failed to connect after multiple retries');
                }
            } else if (connection === 'open') {
                console.log('✅ Bot connected to WhatsApp successfully!');
                isWhatsappConnected = true;
                qrCodeData = null;
                connectionRetries = 0;
                try {
                    if (fs.existsSync('qr.txt')) {
                        fs.unlinkSync('qr.txt');
                    }
                } catch (deleteError) {
                    console.error('❌ Error deleting QR file:', deleteError);
                }
            } else if (connection === 'connecting') {
                console.log('🔄 Connecting to WhatsApp...');
            }
        });

        // Handle incoming messages and button replies
        sock.ev.on("messages.upsert", async (m) => {
            try {
                const message = m.messages[0];
                if (!message.message || message.key.fromMe) return;
                
                const userPhone = message.key.remoteJid.replace('@s.whatsapp.net', '');
                const phoneKey = userPhone.replace(/^20/, '');
                
                console.log(`📨 Incoming message from ${message.key.remoteJid}`);
                
                // Handle interactive button replies
                if (message.message.buttonsResponseMessage) {
                    const buttonId = message.message.buttonsResponseMessage.selectedButtonId;
                    const orderData = pendingOrders.get(phoneKey);
                    
                    if (orderData && buttonId) {
                        await handleButtonResponse(buttonId, phoneKey, orderData, message.key.remoteJid);
                        return;
                    }
                }
                
                // Handle text replies as fallback for buttons
                const text = message.message.conversation || message.message.extendedTextMessage?.text || "";
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
                console.error('❌ Error processing message:', msgError);
            }
        });

    } catch (error) {
        console.error('❌ Error starting bot:', error);
        if (connectionRetries < MAX_RETRIES) {
            connectionRetries++;
            setTimeout(() => startBot(), 15000 * connectionRetries);
        }
    }
}

// Function to handle button responses
async function handleButtonResponse(buttonId, phoneKey, orderData, chatId) {
    try {
        console.log(`🔘 Button clicked: ${buttonId} from ${phoneKey}`);
        if (buttonId === 'confirm_order') {
            await handleOrderConfirmation(phoneKey, orderData, chatId, true);
        } else if (buttonId === 'cancel_order') {
            await handleOrderConfirmation(phoneKey, orderData, chatId, false);
        }
    } catch (error) {
        console.error('❌ Error handling button response:', error);
    }
}

// Function to handle order confirmation or cancellation
async function handleOrderConfirmation(phoneKey, orderData, chatId, isConfirmed) {
    try {
        let responseMessage = "";
        let orderStatus = isConfirmed ? "confirmed" : "cancelled";
        
        if (isConfirmed) {
            responseMessage = `✅ تم تأكيد طلبك بنجاح يا ${orderData.customerName}!`;
        } else {
            responseMessage = `❌ تم إلغاء طلبك يا ${orderData.customerName}`;
        }
        
        await sock.sendMessage(chatId, { text: responseMessage });
        
        await easyOrderApi.updateOrderStatus(orderData.orderId, orderStatus, orderData);
        
        pendingOrders.delete(phoneKey);
        if (orderTimeouts.has(phoneKey)) {
            clearTimeout(orderTimeouts.get(phoneKey));
            orderTimeouts.delete(phoneKey);
        }
        
        console.log(`✅ Order ${orderData.orderId} was ${isConfirmed ? 'confirmed' : 'cancelled'}`);
    } catch (error) {
        console.error('❌ Error processing order confirmation:', error);
        try {
            await sock.sendMessage(chatId, { 
                text: "❌ حدث خطأ في معالجة طلبك. يرجى المحاولة مرة أخرى أو الاتصال بالدعم." 
            });
        } catch (sendError) {
            console.error('❌ Error sending error message:', sendError);
        }
    }
}

// Express server setup
const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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

// Main routes
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
                    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: linear-gradient(135deg, #25D366, #128C7E); text-align: center; padding: 20px; }
                    .container { background: white; padding: 40px; border-radius: 20px; box-shadow: 0 15px 35px rgba(0,0,0,0.1); max-width: 450px; width: 100%; animation: slideUp 0.6s ease-out; }
                    @keyframes slideUp { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
                    img { border: 3px solid #25D366; border-radius: 15px; margin: 20px 0; max-width: 100%; height: auto; box-shadow: 0 8px 20px rgba(0,0,0,0.1); }
                    .status { color: #25D366; font-weight: bold; font-size: 18px; margin: 15px 0; }
                    h1 { color: #128C7E; margin-bottom: 10px; font-size: 28px; }
                    h2 { color: #666; font-size: 18px; margin-bottom: 20px; }
                    .loader { border: 4px solid #f3f3f3; border-top: 4px solid #25D366; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 20px auto; }
                    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                    .instructions { background: #f8f9fa; padding: 15px; border-radius: 10px; margin: 20px 0; font-size: 14px; color: #666; }
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
                    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: linear-gradient(135deg, #25D366, #128C7E); color: white; text-align: center; padding: 20px; }
                    .status-card { background: rgba(255,255,255,0.15); padding: 40px; border-radius: 20px; backdrop-filter: blur(10px); box-shadow: 0 15px 35px rgba(0,0,0,0.2); animation: pulse 3s infinite; max-width: 500px; width: 100%; }
                    @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.02); } }
                    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 20px; margin-top: 30px; }
                    .stat-item { background: rgba(255,255,255,0.2); padding: 20px; border-radius: 15px; backdrop-filter: blur(5px); }
                    .stat-number { font-size: 24px; font-weight: bold; margin-bottom: 5px; }
                    .stat-label { font-size: 14px; opacity: 0.9; }
                    h1 { font-size: 32px; margin-bottom: 10px; }
                    .status-indicator { display: inline-block; width: 12px; height: 12px; background: #4CAF50; border-radius: 50%; margin-left: 10px; animation: blink 2s infinite; }
                    @keyframes blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0.3; } }
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
            res.json({ status: "initializing", message: "البوت في مرحلة التهيئة...", connected: false, retries: connectionRetries });
        }
    } catch (error) {
        console.error('❌ Error on home page:', error);
        res.status(500).json({ error: error.message });
    }
});

// Route for Easy Order requests
app.post("/send-order", async (req, res) => {
    if (!isWhatsappConnected) {
        return res.status(503).json({ error: "البوت غير متصل بواتساب", connected: false, qrAvailable: !!qrCodeData });
    }

    try {
        const data = req.body;
        console.log("📥 New request received:", JSON.stringify(data, null, 2));

        const orderId = data.order_id || data.id || data.order?.id || "غير محدد";
        const customerName = data.customer_name || data.customer?.name || data.name || "عميل";
        const customerPhone = data.customer_phone || data.customer?.phone || data.phone || data.customer?.mobile;
        const total = data.total || data.amount || data.price || data.order?.total || "سيتم تحديده";
        const address = data.address || data.shipping_address || data.customer?.address || "غير محدد";

        if (customerPhone && customerName) {
            logCustomer(customerPhone, customerName);
        }

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
            items = [{ name: data.name, price: data.sale_price || data.price, quantity: data.quantity || 1, description: data.description }];
        }

        console.log(`📝 Order ID: ${orderId}`);
        console.log(`👤 Customer: ${customerName}`);
        console.log(`📱 Phone: ${customerPhone}`);
        console.log(`💰 Total: ${total}`);

        if (!customerPhone) {
            console.log("❌ Customer phone number not found");
            return res.status(400).json({ error: "Customer phone number is required", receivedData: data });
        }

        const orderData = {
            orderId: orderId,
            customerName: customerName,
            customerPhone: customerPhone,
            total: total,
            address: address,
            items: items,
            timestamp: new Date().toISOString()
        };

        const formattedNumber = formatPhoneNumber(customerPhone);
        if (!formattedNumber) {
            return res.status(400).json({ error: "Invalid phone number" });
        }

        const message = generateOrderMessage(orderData);

        const buttons = [
            { buttonId: 'confirm_order', buttonText: { displayText: '✅ تأكيد الطلب' }, type: 1 },
            { buttonId: 'cancel_order', buttonText: { displayText: '❌ إلغاء الطلب' }, type: 1 }
        ];

        const buttonMessage = {
            text: message,
            buttons: buttons,
            headerType: 1
        };

        const phoneKey = customerPhone.toString().replace(/[\s\-\(\)]/g, '').replace(/^0/, '').replace(/^20/, '');
        pendingOrders.set(phoneKey, orderData);

        console.log(`📞 Formatted number: ${formattedNumber}`);
        console.log("📤 Attempting to send message with buttons...");

        await sock.sendMessage(formattedNumber, buttonMessage);

        console.log(`✅ Order with buttons sent successfully to customer`);

        const timeoutId = setTimeout(() => {
            if (pendingOrders.has(phoneKey)) {
                console.log(`⏰ Order ${orderId} timed out - removing from memory`);
                pendingOrders.delete(phoneKey);
                orderTimeouts.delete(phoneKey);
            }
        }, 60 * 60 * 1000); // 1 hour

        orderTimeouts.set(phoneKey, timeoutId);

        res.json({ success: true, message: "Message with buttons sent successfully", orderId: orderId, sentTo: customerPhone, customerName: customerName, formattedNumber: formattedNumber, timestamp: new Date().toISOString() });
    } catch (err) {
        console.error("❌ Error processing request:", err);
        res.status(500).json({ error: "Failed to process request", details: err.message, receivedData: req.body });
    }
});

// New: Route to get the list of logged customers
app.get("/customers", (req, res) => {
    db.all("SELECT phone, name, first_contact FROM customers", [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({
            count: rows.length,
            customers: rows,
            timestamp: new Date().toISOString()
        });
    });
});

// New: Route to send broadcast messages
app.post("/broadcast", async (req, res) => {
    if (!isWhatsappConnected) {
        return res.status(503).json({ error: "البوت غير متصل بواتساب" });
    }
    
    try {
        const { message } = req.body;
        if (!message) {
            return res.status(400).json({ error: "الرسالة مطلوبة" });
        }
        
        db.all("SELECT phone FROM customers", [], async (err, rows) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            
            let successful = 0;
            let failed = 0;
            
            for (const row of rows) {
                const formattedNumber = formatPhoneNumber(row.phone);
                if (formattedNumber) {
                    try {
                        await sock.sendMessage(formattedNumber, { text: message });
                        console.log(`✅ تم إرسال رسالة تسويقية إلى: ${formattedNumber}`);
                        successful++;
                        // Delay between messages to prevent rate-limiting
                        await new Promise(resolve => setTimeout(resolve, 1500));
                    } catch (sendError) {
                        console.error(`❌ فشل إرسال رسالة إلى ${formattedNumber}:`, sendError.message);
                        failed++;
                    }
                } else {
                    failed++;
                }
            }
            
            res.json({
                success: true,
                message: "تم بدء إرسال الرسالة الجماعية",
                total_recipients: rows.length,
                successful: successful,
                failed: failed,
                timestamp: new Date().toISOString()
            });
        });
    } catch (error) {
        console.error('❌ خطأ في الإرسال الجماعي:', error);
        res.status(500).json({ error: error.message });
    }
});


app.get("/pending-orders", (req, res) => {
    const orders = Array.from(pendingOrders.entries()).map(([phone, data]) => ({
        phone: phone,
        ...data,
        timeRemaining: orderTimeouts.has(phone) ? "Available" : "Expired"
    }));
    res.json({ count: pendingOrders.size, orders: orders, timestamp: new Date().toISOString() });
});

app.get("/health", (req, res) => {
    res.json({ status: "OK", uptime: process.uptime(), memory: process.memoryUsage(), connected: isWhatsappConnected, timestamp: new Date().toISOString(), pendingOrders: pendingOrders.size, connectionRetries: connectionRetries });
});

app.post("/restart", (req, res) => {
    try {
        console.log("🔄 Restarting bot...");
        isWhatsappConnected = false;
        qrCodeData = null;
        connectionRetries = 0;
        pendingOrders.clear();
        orderTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
        orderTimeouts.clear();
        if (sock) {
            sock.end();
        }
        setTimeout(() => {
            startBot();
        }, 2000);
        res.json({ success: true, message: "Bot restarted successfully" });
    } catch (error) {
        console.error('❌ Error during restart:', error);
        res.status(500).json({ error: error.message });
    }
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, closing gracefully...');
    if (pendingOrders.size > 0) {
        try {
            const ordersBackup = Array.from(pendingOrders.entries());
            fs.writeFileSync('pending_orders_backup.json', JSON.stringify(ordersBackup, null, 2));
            console.log(`💾 Saved ${pendingOrders.size} pending orders`);
        } catch (backupError) {
            console.error('❌ Error saving backup:', backupError);
        }
    }
    if (sock) {
        sock.end();
    }
    process.exit(0);
});

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server is running on port ${PORT}`);
    console.log(`🌐 Link: http://localhost:${PORT}`);
    setTimeout(() => {
        startBot();
    }, 1000);
});

module.exports = { app, startBot };