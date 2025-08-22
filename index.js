const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// تقديم الملفات الثابتة من مجلد public
app.use(express.static(path.join(__dirname, "public")));

// الصفحة الرئيسية
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

// صفحة الادمن
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// صفحة اليوزر
app.get('/user', (req, res) => {
    res.sendFile(path.join(__dirname, "public", "user.html"));
});

// API لإنشاء يوزر جديد
app.post("/api/create-user", (req, res) => {
    const { username, phone, days } = req.body;
    console.log("تم إنشاء يوزر جديد:", { username, phone, days });
    res.json({ success: true, message: "تم إنشاء المدير بنجاح!" });
});

// API لتحديث رسالة المدير
app.post("/api/update-message", (req, res) => {
    const { message } = req.body;
    console.log("تم تحديث الرسالة:", message);
    res.json({ success: true, message: "تم تحديث الرسالة بنجاح!" });
});

// Catch all للروتس غير الموجودة
app.get('*', (req, res) => {
    res.status(404).send('الصفحة غير موجودة');
});

// تشغيل السيرفر
app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server running on port ${PORT}`);
});