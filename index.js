const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- إعداد قاعدة البيانات (يمكن أن تبقى هنا أو تنقلها) ---
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
const DB_PATH = path.join(DATA_DIR, 'orders.db');
const db = new sqlite3.Database(DB_PATH);
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY, name TEXT, phone TEXT, address TEXT,
    total TEXT, product TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// --- المسارات (Routes) ---
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/user', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'user.html'));
});

app.get('/admin/orders', (req, res) => {
  db.all("SELECT * FROM orders ORDER BY created_at DESC LIMIT 200", (err, rows) => {
    if (err) return res.status(500).json({ error: '' + err });
    res.json(rows);
  });
});

// مسار Webhook لاستقبال الطلبات (سيقوم فقط بحفظها في قاعدة البيانات)
app.post('/webhook', async (req, res) => {
  try {
    const order = req.body;
    const id = order.id || ('o_' + Date.now());
    const name = (order.customer && order.customer.name) ? order.customer.name : (order.name || 'عميل');
    let phone = (order.customer && order.customer.phone) ? order.customer.phone : (order.phone || '');
    const address = (order.customer && order.customer.address) ? order.customer.address : (order.address || '');
    const total = order.total || order.total_price || '';
    const product = order.product || (order.items && order.items[0] && order.items[0].name) || '';

    db.run(`INSERT OR REPLACE INTO orders (id,name,phone,address,total,product) VALUES (?,?,?,?,?,?)`, [id, name, phone, address, total, product]);
    
    // تم حذف كود إرسال رسالة واتساب من هنا
    
    res.json({ status: "saved" });
  } catch (e) {
    console.error('webhook error', e);
    res.status(500).json({ error: e.toString() });
  }
});

// --- تشغيل الخادم ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Webhook server running on port ${PORT}`);
});
