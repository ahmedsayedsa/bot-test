const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const session = require('express-session');
require('dotenv').config();

const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { Firestore } = require('@google-cloud/firestore');
const fs = require('fs');

// --- إعداد الخدمات ---
const app = express();
const firestore = new Firestore();
const usersCollection = firestore.collection('users');

// --- إعداد Express ---
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: process.env.SESSION_SECRET || "whatsapp-secret",
    resave: false,
    saveUninitialized: true,
}));

// --- بوت واتساب ---
const AUTH_DIR = path.join(__dirname, 'auth_info_session');
let sock = null;
let qrCode = null;
let connectionStatus = 'disconnected';
let startTime = new Date();
let sentMessagesCount = 0;

async function startWhatsApp() {
    try {
        if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            browser: ["Ubuntu", "Chrome", "22.04.4"],
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
            retryRequestDelayMs: 1000
        });

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            if (qr) qrCode = qr;
            if (connection === 'open') {
                connectionStatus = 'connected';
                qrCode = null;
                console.log('✅ WhatsApp connected');
            }
            if (connection === 'close') {
                connectionStatus = 'disconnected';
                const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) setTimeout(startWhatsApp, 5000);
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg.message || !msg.key.remoteJid || msg.key.fromMe) return;
            const senderJid = msg.key.remoteJid;
            if (senderJid.endsWith('@g.us')) return;

            try {
                const userDoc = await usersCollection.doc(senderJid).get();
                if (!userDoc.exists) {
                    await sock.sendMessage(senderJid, { text: "أهلاً بك! أنت غير مسجل." });
                    sentMessagesCount++;
                    return;
                }

                const userData = userDoc.data();
                const sub = userData.subscription;
                if (!sub || sub.status !== 'active' || new Date(sub.endDate.toDate()) < new Date()) {
                    await sock.sendMessage(senderJid, { text: "عذراً، اشتراكك غير فعال أو انتهى." });
                    sentMessagesCount++;
                    return;
                }

                let welcomeMessage = userData.messageTemplate || `أهلاً {name}، اشتراكك فعال.`;
                welcomeMessage = welcomeMessage.replace(/\{name\}/g, userData.name);
                await sock.sendMessage(senderJid, { text: welcomeMessage });
                sentMessagesCount++;

            } catch (err) {
                console.error("Error processing message:", err);
            }
        });

    } catch (err) {
        console.error("Error starting WhatsApp:", err);
        setTimeout(startWhatsApp, 10000);
    }
}

// --- Middleware تسجيل الدخول ---
function requireLogin(role) {
    return (req, res, next) => {
        if (!req.session.user || (role && req.session.user.role !== role)) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        next();
    };
}

// --- API تسجيل الدخول ---
app.post('/api/login', async (req, res) => {
    const { phone, password, role } = req.body;

    if (role === 'admin') {
        if (phone === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
            req.session.user = { role: 'admin' };
            return res.json({ success: true, role: 'admin' });
        }
        return res.status(401).json({ error: "Invalid admin credentials" });
    }

    const jid = phone.replace(/\D/g, '') + '@s.whatsapp.net';
    const doc = await usersCollection.doc(jid).get();
    if (!doc.exists) return res.status(404).json({ error: "User not found" });

    req.session.user = { role: 'user', jid };
    res.json({ success: true, role: 'user' });
});

// --- API للمستخدم ---
app.get('/me', requireLogin("user"), async (req, res) => {
    const jid = req.session.user.jid;
    const doc = await usersCollection.doc(jid).get();
    if (!doc.exists) return res.status(404).json({ error: "User not found" });
    res.json(doc.data());
});

app.get('/me/stats', requireLogin("user"), async (req, res) => {
    const jid = req.session.user.jid;
    const uptime = Math.floor((Date.now() - startTime.getTime()) / 1000);
    const webhookUrl = `${req.protocol}://${req.get('host')}/webhook/${encodeURIComponent(jid)}`;

    res.json({
        connectionStatus,
        hasQR: !!qrCode,
        qrImage: qrCode ? `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrCode)}` : null,
        uptimeSeconds: uptime,
        sentMessages: sentMessagesCount,
        webhookUrl
    });
});

// Webhook لاستقبال الطلبات
app.post('/webhook/:jid', async (req, res) => {
    const jid = req.params.jid;
    const { message } = req.body;
    try {
        await sock.sendMessage(jid, { text: message });
        sentMessagesCount++;
        res.json({ success: true });
    } catch (err) {
        console.error("Webhook send error:", err);
        res.status(500).json({ error: "Failed to send message" });
    }
});

// --- API الإدارة ---
app.get('/api/users', requireLogin("admin"), async (req, res) => {
    const snapshot = await usersCollection.get();
    const users = {};
    snapshot.forEach(doc => users[doc.id] = doc.data());
    res.json(users);
});

app.post('/api/users', requireLogin("admin"), async (req, res) => {
    const { name, phone, status, days } = req.body;
    const jid = phone.replace(/\D/g, '') + '@s.whatsapp.net';

    const endDate = new Date();
    endDate.setDate(endDate.getDate() + parseInt(days || 30));

    await usersCollection.doc(jid).set({
        name,
        whatsappJid: jid,
        subscription: {
            status,
            endDate
        }
    }, { merge: true });
    res.json({ success: true });
});

app.post('/api/template', requireLogin("admin"), async (req, res) => {
    const { phone, template } = req.body;
    const jid = phone.replace(/\D/g, '') + '@s.whatsapp.net';
    await usersCollection.doc(jid).set({ messageTemplate: template }, { merge: true });
    res.json({ success: true });
});

// --- الصفحات ---
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/user', (req, res) => res.sendFile(path.join(__dirname, 'public', 'user.html')));

// --- 404 ---
app.use('*', (req, res) => res.status(404).json({ error: 'Not Found' }));

// --- تشغيل ---
(async () => {
    await startWhatsApp();
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server running at http://0.0.0.0:${PORT}`));
})();
