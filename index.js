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

// --- إعداد Express ---
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- إعداد بوت واتساب ---
const AUTH_DIR = path.join(__dirname, 'auth_info_session');
let sock = null;
let qrCode = null;
let connectionStatus = 'disconnected';
let startTime = new Date();

async function startWhatsApp() {
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

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) qrCode = qr;
        if (connection === 'open') {
            connectionStatus = 'connected';
            qrCode = null;
            console.log('✅ WhatsApp connected!');
        }
        if (connection === 'close') {
            connectionStatus = 'disconnected';
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) setTimeout(startWhatsApp, 5000);
        }
    });

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

            // تحديث عداد الرسائل
            await usersCollection.doc(senderJid).set({
                sentMessages: (userData.sentMessages || 0) + 1
            }, { merge: true });

        } catch (error) {
            console.error("Error processing message:", error);
        }
    });
}

// --- API المستخدمين ---
app.get('/api/users', async (req, res) => {
    try {
        const snapshot = await usersCollection.get();
        const users = {};
        snapshot.forEach(doc => { users[doc.id] = doc.data(); });
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: "Failed to get users" });
    }
});

// API بيانات مستخدم واحد
app.get('/api/user/:phone', async (req, res) => {
    try {
        const phone = req.params.phone.replace(/\D/g, '') + '@s.whatsapp.net';
        const doc = await usersCollection.doc(phone).get();

        if (!doc.exists) return res.status(404).json({ error: "User not found" });

        const data = doc.data();
        const runningDays = Math.floor((Date.now() - startTime.getTime()) / (1000 * 60 * 60 * 24));

        res.json({
            ...data,
            runningDays,
            qrImage: qrCode ? `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrCode)}` : null
        });
    } catch (error) {
        res.status(500).json({ error: "Failed to get user" });
    }
});

// إضافة / تحديث مستخدم
app.post('/api/users', async (req, res) => {
    try {
        const { name, phone, status, endDate } = req.body;
        const jid = phone.replace(/\D/g, '') + '@s.whatsapp.net';

        await usersCollection.doc(jid).set({
            name,
            whatsappJid: jid,
            subscription: { status, endDate: new Date(endDate) },
            sentMessages: 0
        }, { merge: true });

        res.status(200).json({ message: 'User saved successfully' });
    } catch (error) {
        res.status(500).json({ error: "Failed to save user" });
    }
});

// تحديث القالب
app.post('/api/template', async (req, res) => {
    try {
        const { phone, template } = req.body;
        const jid = phone.replace(/\D/g, '') + '@s.whatsapp.net';

        await usersCollection.doc(jid).set({ messageTemplate: template }, { merge: true });
        res.status(200).json({ message: 'Template saved' });
    } catch (error) {
        res.status(500).json({ error: "Failed to save template" });
    }
});

// 🔗 Webhook EasyOrder
app.post('/webhook/easyorder', async (req, res) => {
    try {
        const { phone, orderId, details } = req.body;
        const jid = phone.replace(/\D/g, '') + '@s.whatsapp.net';

        const doc = await usersCollection.doc(jid).get();
        if (!doc.exists) return res.status(404).json({ error: "User not found" });

        const userData = doc.data();
        if (!sock) return res.status(500).json({ error: "WhatsApp not connected" });

        let msg = userData.messageTemplate || `✅ تم تسجيل طلبك رقم ${orderId}.`;
        msg = msg.replace(/\{name\}/g, userData.name).replace(/\{orderId\}/g, orderId);

        await sock.sendMessage(jid, { text: msg });

        await usersCollection.doc(jid).set({
            sentMessages: (userData.sentMessages || 0) + 1
        }, { merge: true });

        res.json({ success: true });
    } catch (error) {
        console.error("Error in webhook:", error);
        res.status(500).json({ error: "Webhook failed" });
    }
});

// --- تشغيل ---
async function main() {
    await startWhatsApp();
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server running on http://0.0.0.0:${PORT}`));
}
main().catch(console.error);
