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

async function startWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    sock = makeWASocket({
        version: [2, 24, 0], // يمنع الاعتماد على sqlite3
        auth: state
    });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') console.log('✅ WhatsApp connection opened!');
        if (connection === 'close') {
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

        } catch (error) {
            console.error("Error processing message:", error);
        }
    });
}

// --- مسارات API (تتحدث مع Firestore) ---
app.get('/api/users', async (req, res) => {
    const snapshot = await usersCollection.get();
    const users = {};
    snapshot.forEach(doc => {
        users[doc.id] = doc.data();
    });
    res.json(users);
});

app.post('/api/users', async (req, res) => {
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
});

app.post('/api/template', async (req, res) => {
    const { phone, template } = req.body;
    const jid = phone.replace(/\D/g, '') + '@s.whatsapp.net';

    await usersCollection.doc(jid).set({
        messageTemplate: template
    }, { merge: true }); // merge: true تضيف أو تحدث حقل القالب فقط دون حذف باقي البيانات
    res.status(200).json({ message: 'Template saved' });
});

// --- مسارات عرض الصفحات ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/user', (req, res) => res.sendFile(path.join(__dirname, 'user.html')));

// --- تشغيل كل شيء ---
async function main() {
    await startWhatsApp();
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Server is running on http://0.0.0.0:${PORT}` );
    });
}

main().catch(console.error);
