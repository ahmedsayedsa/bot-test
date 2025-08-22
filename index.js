// استيراد المكتبات المطلوبة
const express = require("express");
const bodyParser = require("body-parser");
const makeWASocket = require("@whiskeysockets/baileys").default;
const { useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const fs = require("fs");
const path = require("path");
const qrcode = require("qrcode");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// قاعدة بيانات بسيطة لتخزين معلومات العملاء
const dbFile = path.join(__dirname, 'db.json');
if (!fs.existsSync(dbFile)) fs.writeFileSync(dbFile, JSON.stringify({ clients: [] }, null, 2));
const loadDB = () => JSON.parse(fs.readFileSync(dbFile));
const saveDB = (data) => fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));

// متغيرات عامة
const clientPool = new Map(); // لتخزين كائنات الواتساب النشطة (sessions)
const EASY_ORDER_API_URL = process.env.EASY_ORDER_API_URL || "https://your-easyorder-domain.com/api";
const EASY_ORDER_API_KEY = process.env.EASY_ORDER_API_KEY || "your-api-key";

// دالة لتشغيل بوت جديد
async function startNewBotSession(sessionId) {
    const authPath = `auth_info_${sessionId}`;
    const { state, saveCreds } = await useMultiFileAuthState(authPath);
    
    console.log(`🚀 بدء تشغيل البوت للجلسة: ${sessionId}...`);

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: [`WhatsApp Bot - ${sessionId}`, "Chrome", "4.0.0"]
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log(`📡 تم إنشاء QR code جديد للجلسة: ${sessionId}`);
            const db = loadDB();
            const client = db.clients.find(c => c.sessionId === sessionId);
            if (client) {
                client.qrCodeData = await qrcode.toDataURL(qr);
                client.status = 'awaiting_qr_scan';
                saveDB(db);
            }
        }
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error = Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`❌ الاتصال مقطوع للجلسة ${sessionId}:`, lastDisconnect?.error, 'إعادة الاتصال:', shouldReconnect);
            
            const clientData = clientPool.get(sessionId);
            if (clientData) {
                clientData.status = 'disconnected';
                if (shouldReconnect) {
                    // إعادة تشغيل الجلسة
                    setTimeout(() => startNewBotSession(sessionId), 10000);
                }
            }
        } else if (connection === 'open') {
            console.log(`✅ البوت متصل بواتساب بنجاح للجلسة: ${sessionId}`);
            const clientData = clientPool.get(sessionId);
            if (clientData) {
                clientData.status = 'connected';
                clientData.qrCodeData = null;
            }
        }
    });

    clientPool.set(sessionId, { sock, status: 'connecting', qrCodeData: null });

    return sock;
}

// دالة لمعالجة الرسائل القادمة من Easy Order
app.post("/webhook", async (req, res) => {
    // يمكنك هنا استخراج رقم هاتف العميل من طلب الـ webhook
    const customerPhone = req.body.phone;
    
    if (!customerPhone) {
        return res.status(400).json({ error: "رقم الهاتف مفقود" });
    }
    
    const db = loadDB();
    let client = db.clients.find(c => c.phone === customerPhone);
    
    if (!client) {
        // إذا كان عميلاً جديداً، قم بإنشاء جلسة جديدة له
        const newSessionId = `client_${Date.now()}`;
        client = {
            sessionId: newSessionId,
            phone: customerPhone,
            name: req.body.name || 'عميل جديد',
            customMessage: null,
            status: 'pending'
        };
        db.clients.push(client);
        saveDB(db);
        startNewBotSession(newSessionId);
    }
    
    // استخدام الجلسة الموجودة لإرسال الرسالة
    const { sock, status } = clientPool.get(client.sessionId);
    if (status === 'connected') {
        const message = client.customMessage || `🌟 مرحباً ${client.name}، هذا طلبك...`;
        await sock.sendMessage(`${customerPhone}@s.whatsapp.net`, { text: message });
        res.json({ status: 'sent' });
    } else {
        res.status(503).json({ error: 'البوت غير متصل حالياً' });
    }
});

// Admin Dashboard - صفحة الإدارة الرئيسية
app.get("/admin", (req, res) => {
    const db = loadDB();
    const clientsList = db.clients.map(client => {
        const currentStatus = clientPool.get(client.sessionId)?.status || 'offline';
        return `
            <li>
                <strong>${client.name} (${client.phone})</strong> - 
                الحالة: ${currentStatus}
                <a href="/admin/client/${client.sessionId}">إدارة</a>
            </li>
        `;
    }).join('');
    
    res.send(`
        <h1>لوحة تحكم البوت</h1>
        <h2>العملاء المسجلون</h2>
        <ul>${clientsList}</ul>
        <br>
        <p>لبدء جلسة جديدة، قم بإرسال طلب إلى الـ webhook.</p>
    `);
});

// صفحة إدارة كل عميل على حدة
app.get('/admin/client/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const db = loadDB();
    const client = db.clients.find(c => c.sessionId === sessionId);
    
    if (!client) {
        return res.status(404).send('العميل غير موجود.');
    }
    
    const clientStatus = clientPool.get(sessionId)?.status || 'offline';
    const qrCodeHtml = client.qrCodeData ? `<img src="${client.qrCodeData}" alt="QR Code">` : '<span>لا يوجد QR code حالياً.</span></span><br><form action="/admin/client/${sessionId}/generate-qr" method="POST"><button type="submit">توليد QR code</button></form>';
    
    res.send(`
        <h1>إدارة العميل - ${client.name}</h1>
        <p>الحالة: <strong>${clientStatus}</strong></p>
        <div>
            <h2>رمز QR</h2>
            ${qrCodeHtml}
        </div>
        <br>
        <form action="/admin/client/${sessionId}/restart" method="POST">
            <button type="submit">إعادة تشغيل البوت</button>
        </form>
        <form action="/admin/client/${sessionId}/delete" method="POST" onsubmit="return confirm('هل أنت متأكد؟')">
            <button type="submit">حذف الجلسة</button>
        </form>
        <hr>
        <a href="/admin">العودة إلى لوحة التحكم</a>
    `);
});

// مسار لإعادة تشغيل البوت
app.post('/admin/client/:sessionId/restart', (req, res) => {
    const { sessionId } = req.params;
    const clientData = clientPool.get(sessionId);
    if (clientData) {
        clientData.sock.end();
        console.log(`🔄 إعادة تشغيل الجلسة: ${sessionId}`);
    }
    res.redirect(`/admin/client/${sessionId}`);
});

// مسار لحذف الجلسة
app.post('/admin/client/:sessionId/delete', (req, res) => {
    const { sessionId } = req.params;
    const authPath = `auth_info_${sessionId}`;
    
    // إيقاف الجلسة النشطة
    const clientData = clientPool.get(sessionId);
    if (clientData) {
        clientData.sock.end();
        clientPool.delete(sessionId);
    }
    
    // حذف ملفات الجلسة
    if (fs.existsSync(authPath)) {
        fs.rmSync(authPath, { recursive: true, force: true });
    }
    
    // حذف من قاعدة البيانات
    const db = loadDB();
    db.clients = db.clients.filter(c => c.sessionId !== sessionId);
    saveDB(db);
    
    console.log(`🗑️ تم حذف الجلسة: ${sessionId}`);
    res.redirect('/admin');
});

// تشغيل البوتات عند بدء تشغيل الخادم
app.listen(3000, () => {
    console.log('🚀 Server running on port 3000');
    
    const db = loadDB();
    if (db.clients && db.clients.length > 0) {
        db.clients.forEach(client => {
            startNewBotSession(client.sessionId);
        });
    }
});