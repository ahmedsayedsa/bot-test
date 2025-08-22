// index.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import bodyParser from "body-parser";

const app = express();
const PORT = process.env.PORT || 3000;

// إعدادات المسارات
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middlewares
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// نخلي Express يخدم ملفات HTML/CSS/JS من public
app.use(express.static(path.join(__dirname, "public")));

// صفحة الأدمن
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// صفحة المستخدم (حسب ID)
app.get("/user/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "user.html"));
});

// API لإنشاء مستخدم جديد (مبدئي)
app.post("/api/create-user", (req, res) => {
  const { username, phone, days } = req.body;
  console.log("✅ مستخدم جديد:", { username, phone, days });
  res.json({ success: true, message: "تم إنشاء المشترك بنجاح" });
});

// API لتحديث رسالة المستخدم (مبدئي)
app.post("/api/update-message", (req, res) => {
  const { message } = req.body;
  console.log("✏️ رسالة جديدة:", message);
  res.json({ success: true, message: "تم تحديث الرسالة بنجاح" });
});

// تشغيل السيرفر
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
