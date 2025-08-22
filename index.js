import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import express from "express";
import bodyParser from "body-parser";
import fs from "fs";
import qrcode from "qrcode-terminal";

const app = express();
app.use(bodyParser.json());

function loadDB() {
  if (!fs.existsSync("database.json")) {
    fs.writeFileSync("database.json", JSON.stringify({ clients: {}, orders: [] }, null, 2));
  }
  return JSON.parse(fs.readFileSync("database.json"));
}

function saveDB(db) {
  fs.writeFileSync("database.json", JSON.stringify(db, null, 2));
}

function isClientActive(clientId) {
  const db = loadDB();
  const client = db.clients[clientId];
  if (!client) return false;
  return new Date(client.expiry) > new Date();
}

function saveOrder(clientId, order) {
  const db = loadDB();
  db.orders.push({ clientId, ...order, date: new Date().toISOString() });
  saveDB(db);
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");
  const { version } = await fetchLatestBaileysVersion();
  
  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true
  });

  sock.ev.on("creds.update", saveCreds);

  return sock;
}

const sockPromise = startBot();

app.get("/settings/:clientId", (req, res) => {
  const db = loadDB();
  const client = db.clients[req.params.clientId] || {};
  res.send(`
    <h2>إعدادات العميل: ${req.params.clientId}</h2>
    <form method="POST" action="/settings/${req.params.clientId}">
      <label>الرسالة:</label><br>
      <textarea name="message" rows="6" cols="40">${client.message || ""}</textarea><br>
      <label>مدة الاشتراك (أيام):</label>
      <input type="number" name="days" value="30"><br>
      <button type="submit">💾 حفظ</button>
    </form>
  `);
});

app.post("/settings/:clientId", (req, res) => {
  const db = loadDB();
  const clientId = req.params.clientId;
  const { message, days } = req.body;
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + parseInt(days));
  db.clients[clientId] = { message, expiry: expiry.toISOString() };
  saveDB(db);
  res.send("✅ تم حفظ البيانات وتحديث الاشتراك");
});

app.get("/export/:clientId", (req, res) => {
  const db = loadDB();
  const orders = db.orders.filter(o => o.clientId === req.params.clientId);
  let csv = "Name,Phone,Product,Total,Address,Date\n";
  orders.forEach(o => {
    csv += `${o.name},${o.phone},${o.product},${o.total},${o.address},${o.date}\n`;
  });
  res.setHeader("Content-disposition", "attachment; filename=orders.csv");
  res.set("Content-Type", "text/csv");
  res.send(csv);
});

app.post("/webhook/:clientId", async (req, res) => {
  const clientId = req.params.clientId;
  const order = req.body;

  if (!isClientActive(clientId)) {
    return res.status(403).send("❌ الاشتراك غير مفعل");
  }

  const db = loadDB();
  const template = db.clients[clientId]?.message || "شكراً {name} على طلبك!";
  const finalMessage = template
    .replace("{name}", order.name || "")
    .replace("{product}", order.product || "")
    .replace("{total}", order.total || "")
    .replace("{orderId}", order.id || "");

  try {
    const sock = await sockPromise;
    await sock.sendMessage(order.phone + "@s.whatsapp.net", { text: finalMessage });
    saveOrder(clientId, order);
    res.send("✅ تم إرسال الرسالة");
  } catch (err) {
    console.error("❌ خطأ في إرسال الرسالة:", err);
    res.status(500).send("❌ خطأ في إرسال الرسالة");
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
