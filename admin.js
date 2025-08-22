const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const PASSWORD = "Qwe@123456"; // غير كلمة السر

// تحميل قاعدة البيانات
const loadClients = () => {
  if (!fs.existsSync('clients.json')) return {};
  return JSON.parse(fs.readFileSync('clients.json'));
};

const saveClients = (data) => {
  fs.writeFileSync('clients.json', JSON.stringify(data, null, 2));
};

// Middleware لحماية الأدمن
router.use((req, res, next) => {
  if (req.query.pass !== PASSWORD && req.path !== '/login' && req.path !== '/doLogin') {
    return res.redirect(`/admin/login`);
  }
  next();
});

// صفحة تسجيل الدخول
router.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// التحقق من الباسورد
router.get('/doLogin', (req, res) => {
  if (req.query.pass === PASSWORD) {
    res.redirect(`/admin?pass=${PASSWORD}`);
  } else {
    res.send("❌ Wrong password");
  }
});

// لوحة التحكم الرئيسية
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// API: جلب العملاء
router.get('/list', (req, res) => {
  res.json(loadClients());
});

// API: إضافة / تعديل عميل
router.post('/save', express.urlencoded({ extended: true }), (req, res) => {
  const { id, name, message, days } = req.body;
  if (!id || !name) return res.send("❌ Missing parameters");

  const clients = loadClients();
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + Number(days || 30));

  clients[id] = {
    name,
    message: message || "شكراً لطلبك 🎉",
    expiry: expiry.toISOString()
  };

  saveClients(clients);
  res.redirect(`/admin?pass=${PASSWORD}`);
});

// API: تنزيل CSV
router.get('/export', (req, res) => {
  const clients = loadClients();
  let csv = "ClientID,Name,Message,Expiry\n";
  for (let id in clients) {
    csv += `${id},${clients[id].name},${clients[id].message},${clients[id].expiry}\n`;
  }
  res.header('Content-Type', 'text/csv');
  res.attachment('clients.csv');
  res.send(csv);
});

module.exports = router;
