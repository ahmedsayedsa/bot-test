const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config();

const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { Firestore } = require('@google-cloud/firestore');
const fs = require('fs');

// --- إعداد الخدمات ---
const app = express();
const firestore = new Firestore();
const usersCollection = firestore.collection('users');

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- بوت واتساب ---
const AUTH_DIR = path.join(__dirname, 'auth_info_session');
let sock = null;
let qrCode = null;
let connectionStatus = 'disconnected';

async function startWhatsApp() {
    try {
        if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            browser: ["Ubuntu", "Chrome", "22.04.4"],
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) qrCode = qr;

            if (connection === 'open') {
                console.log('✅ WhatsApp connected');
                connectionStatus = 'connected';
                qrCode = null;
            }

            if (connection === 'close') {
                connectionStatus = 'disconnected';
                const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) setTimeout(startWhatsApp, 5000);
            }
        });

    } catch (err) {
        console.error("Error starting WhatsApp:", err);
        setTimeout(startWhatsApp, 10000);
    }
}

// --- Webhook EasyOrder ---
app.post('/webhook/order', async (req, res) => {
    try {
        const { customer_name, customer_phone, product_name } = req.body;
        if (!customer_name || !customer_phone) {
            return res.status(400).json({ error: "Invalid order data" });
        }

        const jid = customer_phone.replace(/\D/g, '') + '@s.whatsapp.net';

        // حفظ/تحديث بيانات العميل
        await usersCollection.doc(jid).set({
            name: customer_name,
            whatsappJid: jid,
            lastOrder: { product: product_name, date: new Date() }
        }, { merge: true });

        // جلب بيانات المستخدم
        const userDoc = await usersCollection.doc(jid).get();
        const userData = userDoc.exists ? userDoc.data() : {};

        // القالب
        let template = userData.messageTemplate || "مرحباً {name} 👋\nطلبك لمنتج {product} تم استلامه ✅";
        let message = template.replace(/\{name\}/g, customer_name).replace(/\{product\}/g, product_name);

        if (sock) await sock.sendMessage(jid, { text: message });

        res.json({ success: true, message: "Order processed" });
    } catch (err) {
        console.error("Webhook error:", err);
        res.status(500).json({ error: "Failed to process order" });
    }
});

// --- API المستخدمين ---
app.get('/api/users', async (req, res) => {
    try {
        const snapshot = await usersCollection.get();
        const users = {};
        snapshot.forEach(doc => users[doc.id] = doc.data());
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: "Failed to get users" });
    }
});

app.post('/api/users', async (req, res) => {
    try {
        const { name, phone, status, endDate } = req.body;
        const jid = phone.replace(/\D/g, '') + '@s.whatsapp.net';

        await usersCollection.doc(jid).set({
            name,
            whatsappJid: jid,
            subscription: {
                status,
                endDate: new Date(endDate)
            }
        }, { merge: true });

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Failed to save user" });
    }
});

app.post('/api/template', async (req, res) => {
    try {
        const { phone, template } = req.body;
        const jid = phone.replace(/\D/g, '') + '@s.whatsapp.net';

        await usersCollection.doc(jid).set({ messageTemplate: template }, { merge: true });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Failed to save template" });
    }
});

// --- صفحات HTML للعرض ---
app.get('/user', async (req, res) => {
    try {
        const snapshot = await usersCollection.get();
        let rows = '';
        snapshot.forEach(doc => {
            const u = doc.data();
            rows += `
                <tr>
                    <td>${u.name || '-'}</td>
                    <td>${u.whatsappJid}</td>
                    <td>${u.subscription?.status || '-'}</td>
                    <td>${u.subscription?.endDate?.toDate ? u.subscription.endDate.toDate().toLocaleDateString('ar-EG') : '-'}</td>
                    <td>${u.messageTemplate || '-'}</td>
                </tr>`;
        });

        res.send(`
            <html lang="ar" dir="rtl">
            <head>
                <meta charset="UTF-8">
                <title>لوحة المستخدمين</title>
                <style>
                    body { font-family: sans-serif; background: #f4f6f9; padding: 20px; }
                    table { border-collapse: collapse; width: 100%; background: white; }
                    th, td { border: 1px solid #ddd; padding: 10px; }
                    th { background: #667eea; color: white; }
                </style>
            </head>
            <body>
                <h2>📋 قائمة المستخدمين</h2>
                <table>
                    <tr><th>الاسم</th><th>الرقم</th><th>الحالة</th><th>انتهاء الاشتراك</th><th>القالب</th></tr>
                    ${rows}
                </table>
            </body>
            </html>
        `);
    } catch (err) {
        res.status(500).send("فشل تحميل المستخدمين");
    }
});

app.get('/admin', (req, res) => {
    res.send("<h2>لوحة الإدارة</h2><p>هنا هتضيف واجهة التحكم قريباً 🚀</p>");
});

// --- QR و حالة السيرفر ---
app.get('/api/status', (req, res) => res.json({ status: connectionStatus, hasQR: !!qrCode }));
app.get('/api/qr', (req, res) => {
    if (qrCode) {
        res.json({ qr: qrCode, image: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrCode)}` });
    } else res.json({ status: connectionStatus });
});

// --- تشغيل ---
async function main() {
    await startWhatsApp();
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`🚀 Server running on http://0.0.0.0:${PORT}`));
}
main();
