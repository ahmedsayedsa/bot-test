const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { Firestore } = require('@google-cloud/firestore');

// --- إعداد الخدمات ---
const app = express();
const firestore = new Firestore();
const usersCollection = firestore.collection('users');
const adminCollection = firestore.collection('admins');

// --- إعداد Express ---
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- إعداد بوت واتساب ---
const AUTH_DIR = path.join(__dirname, 'auth_info_session');
let sock = null;
let qrCode = null; 
let connectionStatus = 'disconnected';

// بيانات تسجيل الدخول الافتراضية للإدمن
async function setupDefaultAdmin() {
  try {
    const adminDoc = await adminCollection.doc('admin').get();
    if (!adminDoc.exists) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await adminCollection.doc('admin').set({
        username: 'admin',
        password: hashedPassword,
        createdAt: new Date()
      });
      console.log('✅ تم إنشاء حساب الأدمن الافتراضي');
    }
  } catch (error) {
    console.error('Error setting up admin:', error);
  }
}

async function startWhatsApp() {
    try {
        const fs = require('fs');
        if (!fs.existsSync(AUTH_DIR)) {
            fs.mkdirSync(AUTH_DIR, { recursive: true });
        }

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
            
            if (qr) {
                qrCode = qr; 
                console.log('QR Code generated for web display');
            }
            
            if (connection === 'open') {
                console.log('✅ WhatsApp connection opened!');
                connectionStatus = 'connected';
                qrCode = null; 
            }
            
            if (connection === 'close') {
                connectionStatus = 'disconnected';
                const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) {
                    setTimeout(startWhatsApp, 5000);
                }
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
                    await sock.sendMessage(senderJid, { text: "أهلاً بك! أنت غير مسجل في الخدمة." });
                    return;
                }

                const userData = userDoc.data();
                const sub = userData.subscription;

                if (!sub || sub.status !== 'active' || new Date(sub.endDate.toDate()) < new Date()) {
                    await sock.sendMessage(senderJid, { text: "عذراً، اشتراكك غير فعال أو قد انتهى." });
                    return;
                }

                // زيادة عداد الرسائل
                await usersCollection.doc(senderJid).update({
                    sentMessages: (userData.sentMessages || 0) + 1
                });

                let welcomeMessage = userData.messageTemplate || `أهلاً {name}، اشتراكك فعال.`;
                welcomeMessage = welcomeMessage.replace(/\{name\}/g, userData.name);

                await sock.sendMessage(senderJid, { text: welcomeMessage });

            } catch (error) {
                console.error("Error processing message:", error);
            }
        });
    } catch (error) {
        console.error("Error starting WhatsApp:", error);
        setTimeout(startWhatsApp, 10000); 
    }
}

// --- Middleware للتحقق من تسجيل الدخول ---
async function requireAuth(req, res, next) {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: 'مطلوب تسجيل الدخول' });
  
  try {
    const [username, password] = Buffer.from(token.replace('Basic ', ''), 'base64')
      .toString().split(':');
    
    const adminDoc = await adminCollection.doc(username).get();
    if (!adminDoc.exists) return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
    
    const adminData = adminDoc.data();
    const validPassword = await bcrypt.compare(password, adminData.password);
    if (!validPassword) return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
    
    next();
  } catch (error) {
    res.status(401).json({ error: 'خطأ في المصادقة' });
  }
}

// --- مسارات API ---
// تسجيل الدخول
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (username === 'user') {
      // تسجيل دخول المستخدم
      const userDoc = await usersCollection.doc(phone).get();
      if (!userDoc.exists) return res.status(401).json({ error: 'المستخدم غير موجود' });
      
      const userData = userDoc.data();
      res.json({ 
        token: Buffer.from(`user:${phone}`).toString('base64'),
        type: 'user',
        user: userData
      });
    } else {
      // تسجيل دخول الأدمن
      const adminDoc = await adminCollection.doc(username).get();
      if (!adminDoc.exists) return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
      
      const adminData = adminDoc.data();
      const validPassword = await bcrypt.compare(password, adminData.password);
      if (!validPassword) return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
      
      res.json({ 
        token: Buffer.from(`${username}:${password}`).toString('base64'),
        type: 'admin',
        user: adminData
      });
    }
  } catch (error) {
    res.status(500).json({ error: 'خطأ في تسجيل الدخول' });
  }
});

// صفحة تسجيل الدخول
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// صفحة الأدمن (محمية)
app.get('/admin', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// صفحة المستخدم (محمية)
app.get('/user', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'user.html'));
});

// API للمستخدم
app.get('/api/user/:phone', requireAuth, async (req, res) => {
  try {
    const phone = req.params.phone;
    const jid = phone.replace(/\D/g, '') + '@s.whatsapp.net';
    
    const userDoc = await usersCollection.doc(jid).get();
    if (!userDoc.exists) return res.json({ error: 'المستخدم غير موجود' });

    const userData = userDoc.data();
    const now = new Date();
    const endDate = userData.subscription?.endDate?.toDate();
    const daysLeft = endDate ? Math.ceil((endDate - now) / (1000 * 60 * 60 * 24)) : 0;
    
    res.json({
      ...userData,
      qrImage: qrCode ? `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrCode)}` : null,
      runningDays: Math.floor((now - userData.createdAt?.toDate().getTime()) / (1000 * 60 * 60 * 24)) || 1,
      daysLeft: daysLeft > 0 ? daysLeft : 0,
      subscriptionStatus: userData.subscription?.status || 'inactive'
    });
  } catch (error) {
    res.json({ error: 'خطأ في جلب البيانات' });
  }
});

// API لعرض جميع المستخدمين (للأدمن)
app.get('/api/users', requireAuth, async (req, res) => {
  try {
    const snapshot = await usersCollection.get();
    const users = [];
    
    snapshot.forEach(doc => {
      const userData = doc.data();
      const endDate = userData.subscription?.endDate?.toDate();
      const daysLeft = endDate ? Math.ceil((endDate - new Date()) / (1000 * 60 * 60 * 24)) : 0;
      
      users.push({
        id: doc.id,
        ...userData,
        daysLeft: daysLeft > 0 ? daysLeft : 0,
        isActive: userData.subscription?.status === 'active' && daysLeft > 0
      });
    });
    
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: "Failed to get users" });
  }
});

// API لإضافة/تعديل مستخدم
app.post('/api/users', requireAuth, async (req, res) => {
  try {
    const { name, phone, status, endDate, messageTemplate } = req.body;
    const jid = phone.replace(/\D/g, '') + '@s.whatsapp.net';
    
    const userData = {
      name,
      whatsappJid: jid,
      subscription: {
        status: status || 'active',
        endDate: new Date(endDate)
      },
      messageTemplate: messageTemplate || `أهلاً {name}، اشتراكك فعال حتى {endDate}`,
      createdAt: new Date(),
      sentMessages: 0
    };
    
    await usersCollection.doc(jid).set(userData, { merge: true });
    res.json({ message: 'تم حفظ المستخدم بنجاح' });
  } catch (error) {
    res.status(500).json({ error: "Failed to save user" });
  }
});

// API لتحديث القالب
app.post('/api/template', requireAuth, async (req, res) => {
  try {
    const { phone, template } = req.body;
    const jid = phone.replace(/\D/g, '') + '@s.whatsapp.net';

    await usersCollection.doc(jid).update({
      messageTemplate: template
    });
    res.json({ message: 'تم حفظ القالب' });
  } catch (error) {
    res.status(500).json({ error: "Failed to save template" });
  }
});

// API لحذف مستخدم
app.delete('/api/users/:phone', requireAuth, async (req, res) => {
  try {
    const phone = req.params.phone;
    const jid = phone.replace(/\D/g, '') + '@s.whatsapp.net';
    
    await usersCollection.doc(jid).delete();
    res.json({ message: 'تم حذف المستخدم بنجاح' });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete user" });
  }
});

// --- تشغيل السيرفر ---
async function main() {
  try {
    await setupDefaultAdmin();
    await startWhatsApp();
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server is running on http://0.0.0.0:${PORT}`);
      console.log('🔐 Default admin login: admin / admin123');
    });
  } catch (error) {
    console.error("Error starting server:", error);
    process.exit(1);
  }
}

main().catch(console.error);