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
    try {
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

// --- الصفحة الرئيسية ---
app.get('/', (req, res) => {
    res.json({
        status: 'WhatsApp Bot is running',
        bot_connected: sock ? 'Connected' : 'Disconnected',
        endpoints: {
            users: '/api/users',
            add_user: 'POST /api/users',
            set_template: 'POST /api/template',
            admin_panel: '/admin',
            user_panel: '/user'
        },
        timestamp: new Date().toISOString()
    });
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

// --- Health Check ---
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        bot_status: sock ? 'connected' : 'disconnected',
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