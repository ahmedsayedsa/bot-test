const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const qrcode = require('qrcode-terminal');
require('dotenv').config();

const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const sqlite3 = require('sqlite3').verbose();

// --- إعداد مجلد المصادقة (مهم للبوت) ---
const AUTH_DIR = path.join(__dirname, 'auth_info');
if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR);

// ===================================================================
// (التعديل الرئيسي هنا) إعداد قاعدة البيانات لتعمل على Cloud Run
// ===================================================================
// استخدم المجلد /tmp، وهو المكان الوحيد القابل للكتابة في Cloud Run
const DB_PATH = path.join('/tmp', 'orders.db'); 
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        // هذا السجل سيظهر في Cloud Run Logs إذا فشل الاتصال بقاعدة البيانات
        console.error("Fatal Error: Could not connect to database", err);
    } else {
        console.log("Successfully connected to SQLite database in /tmp/orders.db.");
    }
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    name TEXT,
    phone TEXT,
    address TEXT,
    total TEXT,
    product TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// --- إعداد اتصال واتساب ---
let sock = null;
async function startWhatsApp() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion().catch(()=>({version:[2,2204,13]}));
    console.log('Using Baileys version:', version);

    sock = makeWASocket({
      version,
      printQRInTerminal: true, // اجعلها true لرؤية الـ QR في سجلات Cloud Run
      auth: state,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        console.log("QR code received. Scan it to login. You can find this in Cloud Run logs.");
        // qrcode.generate(qr, { small: true }); // هذا قد لا يعمل جيداً في السجلات، النص العادي أفضل
      }
      if (connection === 'open') {
        console.log('✅ WhatsApp connection opened successfully.');
      }
      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log('Connection closed due to ', lastDisconnect.error, ', reconnecting ', shouldReconnect);
        if (shouldReconnect) {
          setTimeout(() => startWhatsApp(), 5000);
        }
      }
    });
  } catch (error) {
    console.error("Fatal Error in startWhatsApp:", error);
  }
}

// ابدأ تشغيل البوت
startWhatsApp().catch(err => console.error('Failed to start WhatsApp bot:', err));


// --- إعداد خادم Express ---
const app = express();
app.use(cors());
app.use(bodyParser.json());

// --- المسارات (Routes) ---
// يجب أن تكون المسارات المخصصة قبل express.static
app.get('/', (req,res)=>res.json({status:"ok", connected: !!sock, message: "WhatsApp Bot Server is running."}));

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/user', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'user.html'));
});

app.post('/webhook', async (req,res)=>{
  try {
    const order = req.body;
    const id = order.id || ('o_'+Date.now());
    const name = (order.customer && order.customer.name) ? order.customer.name : (order.name || 'عميل');
    let phone = (order.customer && order.customer.phone) ? order.customer.phone : (order.phone || '');
    const address = (order.customer && order.customer.address) ? order.customer.address : (order.address || '');
    const total = order.total || order.total_price || '';
    const product = order.product || (order.items && order.items[0] && order.items[0].name) || '';

    phone = phone.replace(/\D/g,'');
    if (!phone.startsWith('20')) {
      if (phone.startsWith('0')) phone = '20' + phone.substring(1);
      else phone = '20' + phone;
    }
    const jid = phone + '@s.whatsapp.net';

    db.run(`INSERT OR REPLACE INTO orders (id,name,phone,address,total,product) VALUES (?,?,?,?,?,?)`, [id, name, phone, address, total, product]);

    if (!sock) {
      console.error("Webhook received but WhatsApp socket is not ready.");
      return res.status(500).json({error:"WhatsApp not ready"});
    }
    
    const messageText = `أهلاً أ/ ${name} 👋\n📞 ${phone}\n📍 ${address}\n💰 ${total} جنيه\nرقم الطلب: ${id}\n`;
    const buttons = [
      {buttonId: `confirm_${id}`, buttonText: {displayText: "تأكيد الطلب"}, type: 1},
      {buttonId: `cancel_${id}`, buttonText: {displayText: "إلغاء الطلب"}, type: 1}
    ];
    await sock.sendMessage(jid, { text: messageText, buttons });
    res.json({status:"sent"});
  } catch(e) {
    console.error('Webhook error', e);
    res.status(500).json({error: e.toString()});
  }
});

app.get('/admin/orders', (req,res)=>{
  db.all("SELECT * FROM orders ORDER BY created_at DESC LIMIT 200", (err, rows) => {
    if (err) return res.status(500).json({error: ''+err});
    res.json(rows);
  });
});

// هذا السطر يجب أن يأتي بعد تعريف المسارات المخصصة
app.use(express.static(path.join(__dirname, 'public')));


// ===================================================================
// (التعديل الأخير هنا) تشغيل الخادم ليعمل على Cloud Run
// ===================================================================
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Web server listening on port ${PORT}`);
});
