const fs = require('fs').promises;
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const qrcode = require('qrcode-terminal');
require('dotenv').config();

const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');

// --- إعداد المسارات وقاعدة البيانات ---
const AUTH_DIR = path.join(__dirname, 'auth_info_session');
const USERS_DB_PATH = path.join(__dirname, 'users.json');
const TEMPLATES_DIR = path.join(__dirname, 'templates');

// --- دوال مساعدة لقاعدة البيانات (JSON) ---
async function readUsersDB() {
    try {
        const data = await fs.readFile(USERS_DB_PATH, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') return {}; // إذا لم يكن الملف موجوداً، أرجع كائناً فارغاً
        throw error;
    }
}

async function writeUsersDB(data) {
    await fs.writeFile(USERS_DB_PATH, JSON.stringify(data, null, 2));
}

// --- إنشاء المجلدات اللازمة عند بدء التشغيل ---
async function setupDirectories() {
    try {
        await fs.mkdir(AUTH_DIR, { recursive: true });
        await fs.mkdir(TEMPLATES_DIR, { recursive: true });
        console.log("Directories are ready.");
    } catch (error) {
        console.error("Error creating directories:", error);
    }
}

// --- إعداد وتشغيل بوت واتساب ---
let sock = null;
async function startWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    sock = makeWASocket({ printQRInTerminal: true, auth: state });

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
            const users = await readUsersDB();
            const user = users[senderJid];

            if (!user) {
                await sock.sendMessage(senderJid, { text: "أهلاً بك! أنت غير مسجل في الخدمة." });
                return;
            }

            const sub = user.subscription;
            if (!sub || sub.status !== 'active' || new Date(sub.endDate) < new Date()) {
                await sock.sendMessage(senderJid, { text: "عذراً، اشتراكك غير فعال أو قد انتهى." });
                return;
            }

            // --- منطق البوت للمستخدم المشترك (مع استخدام القالب المخصص) ---
            const templatePath = path.join(TEMPLATES_DIR, `${senderJid.split('@')[0]}.txt`);
            let welcomeMessage = `أهلاً ${user.name}، اشتراكك فعال حتى ${new Date(sub.endDate).toLocaleDateString()}.`; // رسالة افتراضية

            try {
                const customTemplate = await fs.readFile(templatePath, 'utf-8');
                // استبدل المتغيرات في القالب المخصص
                welcomeMessage = customTemplate
                    .replace(/\{name\}/g, user.name)
                    .replace(/\{phone\}/g, user.whatsappJid.split('@')[0]);
                    // يمكنك إضافة أي متغيرات أخرى هنا بنفس الطريقة
            } catch (error) {
                // إذا لم يوجد قالب مخصص، لا تفعل شيئاً واستخدم الرسالة الافتراضية
            }

            await sock.sendMessage(senderJid, { text: welcomeMessage });

        } catch (error) {
            console.error("Error processing message:", error);
        }
    });
}

// --- إعداد وتشغيل خادم الويب Express ---
const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- مسارات API ---
app.get('/api/users', async (req, res) => {
    const users = await readUsersDB();
    res.json(users);
});

app.post('/api/users', async (req, res) => {
    const { name, phone, status, endDate } = req.body;
    const jid = phone.replace(/\D/g, '') + '@s.whatsapp.net';
    
    const users = await readUsersDB();
    users[jid] = {
        name,
        whatsappJid: jid,
        subscription: { status, endDate }
    };
    await writeUsersDB(users);
    res.status(200).json({ message: 'User saved successfully' });
});

app.post('/api/template/:phone', async (req, res) => {
    try {
        const phone = req.params.phone.replace(/\D/g, '');
        const template = req.body.template || '';
        const filePath = path.join(TEMPLATES_DIR, `${phone}.txt`);
        await fs.writeFile(filePath, template);
        res.status(200).json({ message: 'Template saved' });
    } catch (error) {
        console.error("Error saving template:", error);
        res.status(500).json({ error: 'Failed to save template' });
    }
});

// --- مسارات عرض الصفحات ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/user', (req, res) => {
    res.sendFile(path.join(__dirname, 'user.html'));
});

// --- تشغيل كل شيء ---
async function main() {
    await setupDirectories();
    await startWhatsApp();
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Server is running on http://0.0.0.0:${PORT}` );
        console.log(`Access the admin page at http://<YOUR_VM_IP>:${PORT}` );
        console.log(`Access the user page at http://<YOUR_VM_IP>:${PORT}/user` );
    });
}

main().catch(console.error);
