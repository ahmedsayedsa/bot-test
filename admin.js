import express from "express";
import { Firestore } from "@google-cloud/firestore";

const router = express.Router();
const firestore = new Firestore();
const usersCollection = firestore.collection("users");

// صفحة HTML بسيطة
router.get("/", (req, res) => {
  res.send(`
    <h2>لوحة التحكم - Admin</h2>
    <form method="post" action="/admin/create">
      رقم العميل: <input name="jid" /><br/>
      الاسم: <input name="name" /><br/>
      مدة الاشتراك (أيام): <input name="days" type="number" /><br/>
      <button type="submit">إضافة اشتراك</button>
    </form>
  `);
});

// إنشاء عميل جديد
router.post("/create", async (req, res) => {
  const { jid, name, days } = req.body;
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + parseInt(days || 3)); // افتراضي 3 أيام
  await usersCollection.doc(jid).set({
    name,
    subscription: { status: "active", endDate: endDate.toISOString() },
    message: "شكراً لاختيارك خدمتنا!",
  });
  res.send("✅ تم إنشاء العميل");
});

export default router;
