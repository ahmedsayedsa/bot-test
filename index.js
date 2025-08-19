const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const makeWASocket = require("@whiskeysockets/baileys").default;
const { useMultiFileAuthState, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    auth: state,
    version,
    printQRInTerminal: true
  });

  sock.ev.on("creds.update", saveCreds);

  // إضافة event listener للتأكد من أن البوت متصل
  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;
    console.log(`🔗 حالة الاتصال: ${connection}`);
    
    if (connection === 'close') {
      console.log('❌ الاتصال مقطوع، محاولة إعادة الاتصال...');
      startBot(); // إعادة محاولة الاتصال
    } else if (connection === 'open') {
      console.log('✅ البوت متصل بنجاح!');
    }
  });

  const app = express();
  
  // إضافة middleware لرصد كل شيء
  app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`\n${'🟢'.repeat(60)}`);
    console.log(`📡 ${timestamp} - ${req.method} ${req.path}`);
    console.log(`🌐 IP: ${req.ip || req.connection.remoteAddress}`);
    console.log(`📋 Headers:`, req.headers);
    console.log(`📦 Query:`, req.query);
    
    if (req.method === 'POST') {
      console.log(`📦 Body:`, req.body);
      console.log(`📦 Raw Body:`, req.rawBody);
    }
    console.log(`${'🟢'.repeat(60)}\n`);
    next();
  });

  // رصد البيانات الخام قبل parsing
  app.use('/webhook', (req, res, next) => {
    let rawData = '';
    req.on('data', chunk => {
      rawData += chunk;
      console.log(`📡 Raw chunk received: ${chunk}`);
    });
    req.on('end', () => {
      console.log(`📡 Complete raw data: ${rawData}`);
      req.rawBody = rawData;
      next();
    });
  });

  app.use(bodyParser.json({ limit: '50mb' }));
  app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
  app.use(bodyParser.raw({ type: 'application/json' }));
  app.use(bodyParser.text({ type: 'text/plain' }));

  // Route لاختبار الاتصال العام
  app.get("/test", (req, res) => {
    console.log("🧪 Test route hit!");
    res.json({ 
      message: "Test successful!",
      timestamp: new Date().toISOString(),
      serverRunning: true
    });
  });

  // Route للتأكد من أن الـ webhook شغال
  app.get("/webhook", (req, res) => {
    console.log("✅ GET request على /webhook - الـ webhook شغال!");
    res.json({ 
      status: "Webhook is working!", 
      timestamp: new Date().toISOString(),
      message: "الـ webhook شغال بنجاح"
    });
  });

  // Route مخصوص لـ Easy Order debugging
  app.all("/webhook", async (req, res) => {
    console.log("\n" + "🔥".repeat(50));
    console.log("📩 WEBHOOK HIT! استلمنا request من Easy Order:");
    console.log("التاريخ والوقت:", new Date().toISOString());
    
    // حفظ كل التفاصيل (Headers + Body)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `easyorder_full_${timestamp}.json`;
    
    const fullData = {
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: req.body,
      query: req.query,
      params: req.params
    };
    
    try {
      fs.writeFileSync(filename, JSON.stringify(fullData, null, 2));
      console.log(`💾 كل التفاصيل محفوظة في: ${filename}`);
    } catch (saveError) {
      console.log("❌ خطأ في حفظ البيانات:", saveError.message);
    }

    // طباعة تفصيلية للبيانات
    console.log("📄 تفاصيل الـ Request:");
    console.log("- Method:", req.method);
    console.log("- URL:", req.url);
    console.log("- Content-Type:", req.headers['content-type']);
    console.log("- User-Agent:", req.headers['user-agent']);
    console.log("- Body Type:", typeof req.body);
    console.log("- Body Content:", JSON.stringify(req.body, null, 2));
    console.log("🔥".repeat(50) + "\n");

    try {
      const data = req.body;

      // فحص مفصل للبيانات
      console.log("🔍 تحليل البيانات:");
      console.log("- نوع البيانات:", typeof data);
      console.log("- المفاتيح الموجودة:", Object.keys(data));
      
      // البحث عن رقم الهاتف بطرق مختلفة
      const possiblePhoneFields = [
        'customer_phone', 'phone', 'mobile', 'customer_mobile',
        'clientPhone', 'client_phone', 'phoneNumber', 'phone_number',
        'whatsapp', 'whatsapp_number'
      ];
      
      let customerPhone = null;
      let phoneField = null;
      
      for (const field of possiblePhoneFields) {
        if (data[field]) {
          customerPhone = data[field];
          phoneField = field;
          break;
        }
      }
      
      console.log(`📱 رقم الهاتف: ${customerPhone} (من الحقل: ${phoneField})`);

      // البحث عن اسم العميل
      const possibleNameFields = [
        'customer_name', 'name', 'client_name', 'clientName',
        'customerName', 'full_name', 'fullName'
      ];
      
      let customerName = null;
      let nameField = null;
      
      for (const field of possibleNameFields) {
        if (data[field]) {
          customerName = data[field];
          nameField = field;
          break;
        }
      }
      
      console.log(`👤 اسم العميل: ${customerName} (من الحقل: ${nameField})`);

      // البحث عن المجموع
      const possibleTotalFields = [
        'total', 'amount', 'totalAmount', 'total_amount',
        'price', 'totalPrice', 'total_price', 'grandTotal'
      ];
      
      let total = null;
      let totalField = null;
      
      for (const field of possibleTotalFields) {
        if (data[field]) {
          total = data[field];
          totalField = field;
          break;
        }
      }
      
      console.log(`💰 المجموع: ${total} (من الحقل: ${totalField})`);

      // البحث عن العناصر/المنتجات
      const possibleItemsFields = [
        'items', 'products', 'orderItems', 'order_items',
        'cart', 'cartItems', 'cart_items', 'details'
      ];
      
      let items = null;
      let itemsField = null;
      
      for (const field of possibleItemsFields) {
        if (data[field]) {
          items = data[field];
          itemsField = field;
          break;
        }
      }
      
      console.log(`🛍️ العناصر: ${items ? JSON.stringify(items) : 'غير موجود'} (من الحقل: ${itemsField})`);

      if (!customerPhone) {
        console.log("❌ لم يتم العثور على رقم هاتف العميل");
        return res.json({ 
          error: "مفيش رقم عميل في الأوردر",
          receivedData: data,
          searchedFields: possiblePhoneFields
        });
      }

      // تنسيق الرقم
      let formattedNumber = customerPhone.toString().trim();
      
      // إزالة أي مسافات أو رموز غير مرغوب فيها
      formattedNumber = formattedNumber.replace(/[\s\-\(\)]/g, '');
      
      // إضافة كود مصر إذا كان الرقم يبدأ بـ 0
      if (formattedNumber.startsWith('0')) {
        formattedNumber = '20' + formattedNumber.substring(1);
      }
      // إضافة كود مصر إذا لم يكن موجود
      else if (!formattedNumber.startsWith('20')) {
        formattedNumber = '20' + formattedNumber;
      }
      
      formattedNumber += '@s.whatsapp.net';
      
      console.log(`📞 الرقم المنسق: ${formattedNumber}`);

      // صياغة قائمة المنتجات
      let itemsList = "";
      if (items && Array.isArray(items)) {
        itemsList = items.map((item, index) => {
          // البحث عن خصائص المنتج بطرق مختلفة
          const name = item.name || item.product_name || item.title || item.productName || `منتج ${index + 1}`;
          const qty = item.qty || item.quantity || item.amount || 1;
          const price = item.price || item.unitPrice || item.unit_price || 0;
          
          return `- ${name} x${qty} = ${price} جنيه`;
        }).join("\n");
      } else if (items && typeof items === 'object') {
        // إذا كانت العناصر object وليس array
        itemsList = Object.entries(items).map(([key, value]) => {
          return `- ${key}: ${value}`;
        }).join("\n");
      }

      // صياغة الرسالة
      let message = `مرحباً ${customerName || "عميلنا الكريم"} 👋\n\n` +
                    `📦 شكراً لطلبك من متجرنا!\n\n`;
      
      if (itemsList) {
        message += `🛍️ تفاصيل الطلب:\n${itemsList}\n\n`;
      }
      
      message += `💰 إجمالي الطلب: ${total || "سيتم تحديده"} جنيه\n\n` +
                 `📞 رقم التواصل: ${customerPhone}\n\n` +
                 `✅ للتأكيد: اكتب "موافق"\n` +
                 `❌ للإلغاء: اكتب "الغاء"`;

      // إرسال الرسالة
      console.log("📤 محاولة إرسال الرسالة...");
      await sock.sendMessage(formattedNumber, { text: message });

      console.log(`✅ تم إرسال الطلب للعميل بنجاح على ${formattedNumber}`);
      
      res.json({ 
        success: true, 
        message: "تم إرسال الرسالة بنجاح",
        sentTo: formattedNumber,
        customerName: customerName,
        total: total
      });

    } catch (err) {
      console.error("❌ خطأ في معالجة الطلب:", err);
      console.error("Stack trace:", err.stack);
      
      res.status(500).json({ 
        error: "فشل في معالجة الطلب",
        details: err.message,
        receivedData: req.body
      });
    }
  });

  // Route لاختبار إرسال رسالة يدوية
  app.post("/test-send", async (req, res) => {
    try {
      const { phone, message } = req.body;
      
      if (!phone || !message) {
        return res.json({ error: "مطلوب رقم هاتف ورسالة" });
      }
      
      let formattedNumber = phone.toString().replace(/^0/, "20") + "@s.whatsapp.net";
      
      await sock.sendMessage(formattedNumber, { text: message });
      
      console.log(`✅ رسالة اختبار تم إرسالها إلى ${formattedNumber}`);
      res.json({ success: true, sentTo: formattedNumber });
      
    } catch (error) {
      console.error("❌ خطأ في إرسال رسالة الاختبار:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Route للحصول على حالة البوت
  app.get("/status", (req, res) => {
    res.json({
      botStatus: "running",
      timestamp: new Date().toISOString(),
      webhookUrl: `/webhook`,
      testUrl: `/test-send`
    });
  });

  // Route لعرض آخر البيانات المستلمة
  app.get("/last-data", (req, res) => {
    try {
      // قراءة آخر ملف بيانات
      const files = fs.readdirSync('.').filter(f => f.startsWith('easyorder_full_'));
      if (files.length === 0) {
        return res.json({ message: "لم يتم استلام أي بيانات بعد" });
      }
      
      const latestFile = files.sort().pop();
      const data = JSON.parse(fs.readFileSync(latestFile, 'utf8'));
      
      res.json({
        message: "آخر البيانات المستلمة",
        filename: latestFile,
        data: data
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // إضافة routes للتشخيص
  app.get("/", (req, res) => {
    res.json({
      message: "🤖 WhatsApp Bot is running!",
      timestamp: new Date().toISOString(),
      endpoints: {
        webhook: "/webhook (POST)",
        status: "/status (GET)", 
        lastData: "/last-data (GET)",
        testSend: "/test-send (POST)"
      }
    });
  });

  // إضافة catch-all route لرصد أي requests أخرى
  app.all("*", (req, res) => {
    console.log(`🤔 Request غير متوقع: ${req.method} ${req.path}`);
    console.log("Headers:", req.headers);
    console.log("Body:", req.body);
    
    res.json({
      message: "Route غير موجود",
      method: req.method,
      path: req.path,
      availableEndpoints: ["/webhook", "/status", "/last-data", "/test-send"]
    });
  });

  const PORT = process.env.PORT || 5000;
  const HOST = '127.0.0.1'; // استخدام IPv4 بدلاً من localhost
  
  app.listen(PORT, HOST, () => {
    console.log(`🚀 Webhook server شغال على http://${HOST}:${PORT}`);
    console.log(`📊 لمراجعة الحالة: http://${HOST}:${PORT}/status`);
    console.log(`📋 لمراجعة آخر البيانات: http://${HOST}:${PORT}/last-data`);
    console.log(`🧪 لاختبار الإرسال: POST إلى http://${HOST}:${PORT}/test-send`);
    console.log(`📨 webhook URL: http://${HOST}:${PORT}/webhook`);
    console.log(`🌐 Public ngrok URL: استخدم 'ngrok http ${PORT}' في terminal جديد`);
  });

  // التعامل مع الرسائل الواردة (للتأكيد والإلغاء)
  sock.ev.on("messages.upsert", async (m) => {
    const message = m.messages[0];
    
    if (!message.message || message.key.fromMe) return;
    
    const text = message.message.conversation || 
                 message.message.extendedTextMessage?.text || "";
    
    console.log(`📨 رسالة واردة من ${message.key.remoteJid}: ${text}`);
    
    if (text.toLowerCase().includes("موافق") || text.toLowerCase().includes("تأكيد")) {
      await sock.sendMessage(message.key.remoteJid, { 
        text: "✅ تم تأكيد طلبك بنجاح! سيتم التحضير والتوصيل قريباً. شكراً لثقتك 🙏" 
      });
      console.log("✅ تم تأكيد الطلب");
      
    } else if (text.toLowerCase().includes("الغاء") || text.toLowerCase().includes("إلغاء")) {
      await sock.sendMessage(message.key.remoteJid, { 
        text: "❌ تم إلغاء طلبك. نأسف لعدم تمكننا من خدمتك هذه المرة 😔" 
      });
      console.log("❌ تم إلغاء الطلب");
    }
  });
}

// إضافة error handling عامة
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

startBot().catch(err => {
  console.error("❌ خطأ في بدء البوت:", err);
});