import express from "express";
import { Firestore } from "@google-cloud/firestore";

const router = express.Router();
const firestore = new Firestore();
const usersCollection = firestore.collection("users");

// صفحة تعديل الرسالة
router.get("/:jid", async (req, res) => {
  const { jid } = req.params;
  const userDoc = await usersCollection.doc(jid).get();
  if (!userDoc.exists) return res.send("❌ غير موجود");

  const userData = userDoc.data();
  res.send(`
    <h2>تخصيص الرسالة</h2>
    <form method="post" action="/user/${jid}">
      <textarea name="message" rows="5" cols="40">${userData.message || ""}</textarea><br/>
      <button type="submit">حفظ</button>
    </form>
    <p>ملاحظات: 
      - اكتب [name] لإظهار اسم العميل.
      - اكتب [order] لرقم الطلب.
    </p>
  `);
});

router.post("/:jid", async (req, res) => {
  const { jid } = req.params;
  const { message } = req.body;
  await usersCollection.doc(jid).update({ message });
  res.send("✅ تم حفظ الرسالة");
});

export default router;
