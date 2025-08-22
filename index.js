const express = require('express');
const { Boom } = require('@hapi/boom');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// قاعدة بيانات بسيطة
const dbFile = path.join(__dirname, 'db.json');
if (!fs.existsSync(dbFile)) fs.writeFileSync(dbFile, JSON.stringify({ users: [] }, null, 2));
const loadDB = () => JSON.parse(fs.readFileSync(dbFile));
const saveDB = (data) => fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));

let sock;

// بدء الاتصال بواتساب
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  sock = makeWASocket({ auth: state });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect.error = Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) connectToWhatsApp();
    } else if (connection === 'open') {
      console.log('✅ Connected to WhatsApp');
    }
  });
}

// API لإرسال رسالة للعميل
app.post('/send', async (req, res) => {
  const { phone, name, orderId, product, total, address } = req.body;

  const db = loadDB();
  let user = db.users.find((u) => u.phone === phone);
  if (!user) {
    user = { phone, customMessage: null };
    db.users.push(user);
    saveDB(db);
  }

  const message =
    user.customMessage ||
    `🌟 أهلاً وسهلاً ${name}

شكرًا لاختيارك اوتو سيرفس! تم استلام طلبك بنجاح 🎉

🆔 رقم الطلب: #${orderId}
🛍️ تفاصيل الطلب: ${product}
💰 الإجمالي: ${total}
📍 عنوان التوصيل: ${address}

⚠️ ملاحظة مهمة: المعاينة غير متاحة وقت الاستلام
🔄 يُرجى تأكيد طلبك للبدء في التحضير والشحن`;

  await sock.sendMessage(`${phone}@s.whatsapp.net`, { text: message });
  res.json({ status: '✅ sent', to: phone });
});

// صفحة إدارة لتغيير الرسالة
app.get('/admin/:phone', (req, res) => {
  const phone = req.params.phone;
  const db = loadDB();
  const user = db.users.find((u) => u.phone === phone);
  res.send(`
    <h1>إدارة الرسالة - ${phone}</h1>
    <form method="post" action="/admin/${phone}">
      <textarea name="msg" rows="10" cols="40">${user?.customMessage || ''}</textarea><br/>
      <button type="submit">حفظ</button>
    </form>
  `);
});

app.post('/admin/:phone', express.urlencoded({ extended: true }), (req, res) => {
  const phone = req.params.phone;
  const db = loadDB();
  const user = db.users.find((u) => u.phone === phone);
  if (user) {
    user.customMessage = req.body.msg;
    saveDB(db);
  }
  res.redirect(`/admin/${phone}`);
});

app.listen(3000, () => console.log('🚀 Server running on port 3000'));
connectToWhatsApp();
