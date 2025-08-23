import express from "express";
import bodyParser from "body-parser";
import fs from "fs";
import path from "path";

const app = express();
const PORT = process.env.PORT || 3000;

// middlewares
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// مكان تخزين البيانات (مؤقت)
const dataFile = path.join("./users.json");

// helper functions
function loadUsers() {
  if (!fs.existsSync(dataFile)) return {};
  return JSON.parse(fs.readFileSync(dataFile, "utf-8"));
}

function saveUsers(users) {
  fs.writeFileSync(dataFile, JSON.stringify(users, null, 2));
}

// ✅ صفحة الأدمن
app.get("/admin", (req, res) => {
  res.send(`
    <h1>لوحة التحكم - الأدمن</h1>
    <form method="POST" action="/create-user">
      <input type="text" name="username" placeholder="اسم العميل" required />
      <input type="text" name="userId" placeholder="ID العميل (مثال: user1)" required />
      <input type="number" name="days" placeholder="مدة الاشتراك (بالأيام)" required />
      <button type="submit">إنشاء اشتراك</button>
    </form>
  `);
});

// ✅ إنشاء عميل جديد
app.post("/create-user", (req, res) => {
  const { username, userId, days } = req.body;
  const users = loadUsers();

  const expiry = Date.now() + days * 24 * 60 * 60 * 1000;

  users[userId] = {
    username,
    expiry,
    message:
      "🌟 أهلاً {{name}}\nشكراً لاختيارك اوتو سيرفس! طلبك رقم {{order_id}} - المنتج: {{product}}",
  };

  saveUsers(users);
  res.send(`<p>تم إنشاء المستخدم ${username} بنجاح. <a href="/admin">رجوع</a></p>`);
});

// ✅ صفحة العميل لتخصيص الرسالة
app.get("/user/:id", (req, res) => {
  const userId = req.params.id;
  const users = loadUsers();

  if (!users[userId]) {
    return res.status(404).send("⚠️ المستخدم غير موجود");
  }

  res.send(`
    <h1>إعداد الرسائل للعميل ${users[userId].username}</h1>
    <form method="POST" action="/save-message/${userId}">
      <textarea name="message" rows="8" cols="50">${users[userId].message}</textarea>
      <br/>
      <button type="submit">حفظ</button>
    </form>
    <p>استخدم المتغيرات التالية داخل الرسالة:</p>
    <ul>
      <li><b>{{name}}</b> → اسم العميل</li>
      <li><b>{{order_id}}</b> → رقم الطلب</li>
      <li><b>{{product}}</b> → المنتج</li>
    </ul>
  `);
});

// ✅ حفظ رسالة العميل
app.post("/save-message/:id", (req, res) => {
  const userId = req.params.id;
  const users = loadUsers();

  if (!users[userId]) {
    return res.status(404).send("⚠️ المستخدم غير موجود");
  }

  users[userId].message = req.body.message;
  saveUsers(users);

  res.send(`<p>✅ تم تحديث الرسالة للعميل ${users[userId].username}</p><a href="/user/${userId}">رجوع</a>`);
});

// ✅ Webhook بيستقبل الأوردر من Easy Order
app.post("/webhook", (req, res) => {
  const { userId, order } = req.body; // لازم Easy Order يبعت userId كمان
  const users = loadUsers();

  if (!users[userId]) {
    return res.status(404).send({ error: "المستخدم غير موجود" });
  }

  // تحقق من صلاحية الاشتراك
  if (Date.now() > users[userId].expiry) {
    return res.status(403).send({ error: "الاشتراك منتهي" });
  }

  let msg = users[userId].message;
  msg = msg.replace("{{name}}", order.name || "العميل");
  msg = msg.replace("{{order_id}}", order.id || "#0000");
  msg = msg.replace("{{product}}", order.product || "منتج");

  console.log("🚀 رسالة للعميل:", msg);

  // هنا تدمج مع واتساب
  // sendWhatsAppMessage(order.phone, msg);

  res.send({ status: "ok", message: msg });
});

// ✅ تشغيل السيرفر
app.listen(PORT, () => {
  console.log(`🚀 السيرفر شغال على http://localhost:${PORT}`);
});
