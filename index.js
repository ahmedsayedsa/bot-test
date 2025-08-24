const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config();

const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { Firestore } = require('@google-cloud/firestore');

// --- إعداد الخدمات ---
const app = express();
const firestore = new Firestore();
const usersCollection = firestore.collection('users'); // مجموعة لتخزين المستخدمين والاشتراكات والقوالب

// --- إعداد Express ---
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- إعداد بوت واتساب ---
const AUTH_DIR = path.join(__dirname, 'auth_info_session');
let sock = null;
let qrCode = null; // لحفظ QR Code
let connectionStatus = 'disconnected';

async function startWhatsApp() {
    try {
        // إنشاء المجلد إذا لم يكن موجوداً
        const fs = require('fs');
        if (!fs.existsSync(AUTH_DIR)) {
            fs.mkdirSync(AUTH_DIR, { recursive: true });
        }

        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
        sock = makeWASocket({
            auth: state,
            printQRInTerminal: true, // لطباعة QR Code في الـ terminal
            browser: ["Ubuntu", "Chrome", "22.04.4"],
            connectTimeoutMs: 60000, // زيادة timeout
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
            retryRequestDelayMs: 1000
        });

async function startWhatsApp() {
    try {
        // إنشاء المجلد إذا لم يكن موجوداً
        const fs = require('fs');
        if (!fs.existsSync(AUTH_DIR)) {
            fs.mkdirSync(AUTH_DIR, { recursive: true });
        }

        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false, // عدم طباعة QR في terminal
            browser: ["Ubuntu", "Chrome", "22.04.4"],
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
            retryRequestDelayMs: 1000
        });

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                qrCode = qr; // حفظ QR Code
                console.log('QR Code generated for web display');
            }
            
            if (connection === 'open') {
                console.log('✅ WhatsApp connection opened!');
                connectionStatus = 'connected';
                qrCode = null; // مسح QR Code بعد الاتصال
            }
            
            if (connection === 'close') {
                connectionStatus = 'disconnected';
                const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) {
                    setTimeout(startWhatsApp, 5000);
                }
        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg.message || !msg.key.remoteJid || msg.key.fromMe) return;

            const senderJid = msg.key.remoteJid;
            if (senderJid.endsWith('@g.us')) return;

            try {
                const userDoc = await usersCollection.doc(senderJid).get();

                if (!userDoc.exists) {
                    await sock.sendMessage(senderJid, { text: "أهلاً بك! أنت غير مسجل في الخدمة." });
                    return;
                }

                const userData = userDoc.data();
                const sub = userData.subscription;

                if (!sub || sub.status !== 'active' || new Date(sub.endDate.toDate()) < new Date()) {
                    await sock.sendMessage(senderJid, { text: "عذراً، اشتراكك غير فعال أو قد انتهى." });
                    return;
                }

                let welcomeMessage = userData.messageTemplate || `أهلاً {name}، اشتراكك فعال.`;
                welcomeMessage = welcomeMessage.replace(/\{name\}/g, userData.name);

                await sock.sendMessage(senderJid, { text: welcomeMessage });

            } catch (error) {
                console.error("Error processing message:", error);
            }
        });
    } catch (error) {
        console.error("Error starting WhatsApp:", error);
        setTimeout(startWhatsApp, 10000); // إعادة المحاولة بعد 10 ثواني
    }
}

// --- مسارات API (تتحدث مع Firestore) ---
app.get('/api/users', async (req, res) => {
    try {
        const snapshot = await usersCollection.get();
        const users = {};
        snapshot.forEach(doc => {
            users[doc.id] = doc.data();
        });
        res.json(users);
    } catch (error) {
        console.error("Error getting users:", error);
        res.status(500).json({ error: "Failed to get users" });
    }
});

app.post('/api/users', async (req, res) => {
    try {
        const { name, phone, status, endDate } = req.body;
        const jid = phone.replace(/\D/g, '') + '@s.whatsapp.net';
        
        const userData = {
            name,
            whatsappJid: jid,
            subscription: {
                status,
                endDate: new Date(endDate)
            }
        };
        // استخدام merge: true لتحديث المستخدم إذا كان موجوداً أو إنشائه إذا لم يكن
        await usersCollection.doc(jid).set(userData, { merge: true });
        res.status(200).json({ message: 'User saved successfully' });
    } catch (error) {
        console.error("Error saving user:", error);
        res.status(500).json({ error: "Failed to save user" });
    }
});

app.post('/api/template', async (req, res) => {
    try {
        const { phone, template } = req.body;
        const jid = phone.replace(/\D/g, '') + '@s.whatsapp.net';

        await usersCollection.doc(jid).set({
            messageTemplate: template
        }, { merge: true }); // merge: true تضيف أو تحدث حقل القالب فقط دون حذف باقي البيانات
        res.status(200).json({ message: 'Template saved' });
    } catch (error) {
        console.error("Error saving template:", error);
        res.status(500).json({ error: "Failed to save template" });
    }
});

// --- الصفحة الرئيسية مع QR Code ---
app.get('/', (req, res) => {
    const qrImage = qrCode ? `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrCode)}` : null;
    
    res.send(`
        <!DOCTYPE html>
        <html dir="rtl" lang="ar">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>WhatsApp Bot Dashboard</title>
            <style>
                body {
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    margin: 0;
                    padding: 20px;
                    min-height: 100vh;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                }
                .container {
                    background: white;
                    border-radius: 20px;
                    padding: 40px;
                    box-shadow: 0 20px 40px rgba(0,0,0,0.1);
                    text-align: center;
                    max-width: 500px;
                    width: 100%;
                }
                .status {
                    font-size: 24px;
                    margin-bottom: 20px;
                    font-weight: bold;
                }
                .connected { color: #4CAF50; }
                .disconnected { color: #f44336; }
                .qr-container {
                    margin: 30px 0;
                    padding: 20px;
                    border: 2px dashed #ccc;
                    border-radius: 10px;
                }
                .qr-code {
                    max-width: 100%;
                    height: auto;
                }
                .endpoints {
                    text-align: right;
                    margin-top: 30px;
                    padding: 20px;
                    background: #f5f5f5;
                    border-radius: 10px;
                }
                .endpoint {
                    margin: 10px 0;
                    padding: 10px;
                    background: white;
                    border-radius: 5px;
                    border-right: 4px solid #667eea;
                }
                .refresh-btn {
                    background: #667eea;
                    color: white;
                    border: none;
                    padding: 12px 24px;
                    border-radius: 25px;
                    cursor: pointer;
                    font-size: 16px;
                    margin-top: 20px;
                }
                .refresh-btn:hover {
                    background: #5a6fd8;
                }
            </style>
            <script>
                // تحديث الصفحة كل 10 ثواني
                setTimeout(() => {
                    if (document.querySelector('.disconnected')) {
                        location.reload();
                    }
                }, 10000);
            </script>
        </head>
        <body>
            <div class="container">
                <h1>🤖 WhatsApp Bot Dashboard</h1>
                <div class="status ${connectionStatus === 'connected' ? 'connected' : 'disconnected'}">
                    ${connectionStatus === 'connected' ? '✅ متصل' : '🔄 غير متصل'}
                </div>
                
                ${qrCode ? `
                    <div class="qr-container">
                        <h3>📱 امسح الكود للاتصال</h3>
                        <img src="${qrImage}" alt="QR Code" class="qr-code" />
                        <p>افتح واتساب → الأجهزة المُقترنة → ربط جهاز</p>
                    </div>
                ` : connectionStatus === 'connected' ? `
                    <div style="color: #4CAF50; font-size: 18px; margin: 20px 0;">
                        🎉 البوت متصل ويعمل بنجاح!
                    </div>
                ` : `
                    <div style="color: #ff9800; margin: 20px 0;">
                        ⏳ جاري الاتصال بواتساب...
                    </div>
                `}
                
                <div class="endpoints">
                    <h3>🔗 المسارات المتاحة:</h3>
                    <div class="endpoint">
                        <strong>GET /api/users</strong> - عرض جميع المستخدمين
                    </div>
                    <div class="endpoint">
                        <strong>POST /api/users</strong> - إضافة مستخدم جديد
                    </div>
                    <div class="endpoint">
                        <strong>POST /api/template</strong> - تحديث قالب الرسالة
                    </div>
                    <div class="endpoint">
                        <strong>GET /admin</strong> - لوحة الإدارة
                    </div>
                    <div class="endpoint">
                        <strong>GET /user</strong> - لوحة المستخدمين
                    </div>
                </div>
                
                <button class="refresh-btn" onclick="location.reload()">🔄 تحديث</button>
                
                <div style="margin-top: 20px; color: #666; font-size: 14px;">
                    آخر تحديث: ${new Date().toLocaleString('ar-EG')}
                </div>
            </div>
        </body>
        </html>
    `);
});

// --- صفحات الإدارة والمستخدمين ---
app.get('/admin', (req, res) => {
    // إذا كان لديك ملف admin.html، استخدم هذا:
    // res.sendFile(path.join(__dirname, 'admin.html'));
    
    // وإلا، أرسل رسالة JSON:
    res.json({
        message: 'Admin Panel',
        available_actions: [
            'GET /api/users - عرض جميع المستخدمين',
            'POST /api/users - إضافة مستخدم جديد',
            'POST /api/template - تحديث قالب الرسالة'
        ]
    });
});

app.get('/user', (req, res) => {
    // إذا كان لديك ملف user.html، استخدم هذا:
    // res.sendFile(path.join(__dirname, 'user.html'));
    
    // وإلا، أرسل رسالة JSON:
    res.json({
        message: 'User Panel',
        info: 'صفحة المستخدمين - يمكن إضافة واجهة مستخدم هنا'
    });
});

// --- QR Code API ---
app.get('/api/qr', (req, res) => {
    if (qrCode) {
        res.json({ 
            qr: qrCode, 
            status: 'قم بمسح الكود',
            image: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrCode)}`
        });
    } else if (connectionStatus === 'connected') {
        res.json({ 
            status: 'متصل بالفعل',
            message: 'البوت متصل ولا يحتاج QR Code'
        });
    } else {
        res.json({ 
            status: 'جاري الاتصال...',
            message: 'انتظر قليلاً حتى يتم إنشاء QR Code'
        });
    }
});

// --- حالة البوت ---
app.get('/api/status', (req, res) => {
    res.json({
        status: connectionStatus,
        hasQR: !!qrCode,
        timestamp: new Date().toISOString()
    });
});

// --- معالج 404 ---
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Page not found',
        available_endpoints: [
            'GET / - الصفحة الرئيسية',
            'GET /admin - لوحة الإدارة',
            'GET /user - لوحة المستخدمين',
            'GET /api/users - عرض المستخدمين',
            'POST /api/users - إضافة مستخدم',
            'POST /api/template - تحديث القالب'
        ]
    });
});

// --- تشغيل كل شيء ---
async function main() {
    try {
        await startWhatsApp();
        const PORT = process.env.PORT || 5000;
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Server is running on http://0.0.0.0:${PORT}`);
        });
    } catch (error) {
        console.error("Error starting server:", error);
        process.exit(1);
    }
}

main().catch(console.error);