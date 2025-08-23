const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const qrcode = require('qrcode-terminal');
require('dotenv').config();

const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const sqlite3 = require('sqlite3').verbose();

const AUTH_DIR = path.join(__dirname, 'auth_info');
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR);
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const DB_PATH = path.join(DATA_DIR, 'orders.db');
const db = new sqlite3.Database(DB_PATH);
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

let sock = null;
async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion().catch(()=>({version:[2,2204,13]}));
  console.log('Baileys version to connect:', version);

  sock = makeWASocket({
    version,
    printQRInTerminal: false,
    auth: state,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log("📌 QR code received. Scan it with WhatsApp to login.");
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') {
      console.log('✅ WhatsApp connection opened');
    }
    if (connection === 'close') {
      console.log('connection closed, restarting in 5s', lastDisconnect ? lastDisconnect.error : '');
      setTimeout(()=>startWhatsApp(), 5000);
    }
  });
}

startWhatsApp().catch(err => console.error('start error', err));

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req,res)=>res.json({status:"ok", connected: !!sock}));

// Routes for HTML pages
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

    const tmplPath = path.join(DATA_DIR, 'templates', phone + '.txt');
    let messageText = `أهلاً أ/ ${name} 👋\n📞 ${phone}\n📍 ${address}\n💰 ${total} جنيه\nرقم الطلب: ${id}\n`;
    if (fs.existsSync(tmplPath)) {
      try {
        let t = fs.readFileSync(tmplPath,'utf-8');
        messageText = t.replace(/\{name\}/g, name).replace(/\{phone\}/g, phone).replace(/\{address\}/g, address).replace(/\{total\}/g, total).replace(/\{order_id\}/g, id).replace(/\{product\}/g, product);
      } catch(e){ console.error('template read error', e); }
    }

    if (!sock) return res.status(500).json({error:"WhatsApp not ready"});

    const buttons = [
      {buttonId: `confirm_${id}`, buttonText: {displayText: "تأكيد الطلب"}, type: 1},
      {buttonId: `cancel_${id}`, buttonText: {displayText: "إلغاء الطلب"}, type: 1}
    ];

    const buttonsMessage = {
      contentText: messageText,
      footerText: "جاري التعامل مع طلبك",
      buttons: buttons,
      headerType: 1
    };

    await sock.sendMessage(jid, {buttonsMessage});
    res.json({status:"sent"});
  } catch(e) {
    console.error('webhook error', e);
    res.status(500).json({error: e.toString()});
  }
});

app.get('/admin/orders', (req,res)=>{
  db.all("SELECT * FROM orders ORDER BY created_at DESC LIMIT 200", (err, rows) => {
    if (err) return res.status(500).json({error: ''+err});
    res.json(rows);
  });
});

app.post('/admin/template/:phone', (req,res)=>{
  const phone = req.params.phone.replace(/\\D/g,'');
  const dir = path.join(DATA_DIR,'templates');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive:true});
  fs.writeFileSync(path.join(dir, phone + '.txt'), req.body.template || '');
  res.json({ok:true});
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, ()=>console.log('🚀 Webhook server running on port', PORT));