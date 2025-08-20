# بوت واتساب محسن للتكامل مع Easy Order

## نظرة عامة

هذا البوت مصمم لإرسال رسائل واتساب تحتوي على تفاصيل الطلبات مع أزرار تفاعلية للتأكيد أو الإلغاء، مع تحديث حالة الطلب تلقائياً على موقع Easy Order.

## المميزات الرئيسية

### 🚀 الوظائف الأساسية
- **إرسال رسائل تفاعلية**: رسائل مع أزرار تأكيد/إلغاء
- **تحديث تلقائي**: تحديث حالة الطلب في Easy Order
- **معالجة أخطاء متقدمة**: إعادة المحاولة والتعامل مع الأخطاء
- **واجهة ويب**: لوحة تحكم لمراقبة البوت

### 🔧 المميزات التقنية
- **دعم endpoints متعددة**: يجرب عدة نقاط نهاية لـ Easy Order API
- **نظام إعادة المحاولة**: محاولات متعددة مع تأخير متزايد
- **تسجيل شامل**: حفظ جميع العمليات والأخطاء
- **اختبارات تلقائية**: سكريبتات اختبار شاملة

## متطلبات النظام

- Node.js 18.0.0 أو أحدث
- npm 8.0.0 أو أحدث
- اتصال إنترنت مستقر
- حساب واتساب للربط

## التثبيت والإعداد

### 1. تحميل المشروع
```bash
git clone <repository-url>
cd whatsapp-bot-easyorder
```

### 2. تثبيت المتطلبات
```bash
npm install
```

### 3. إعداد متغيرات البيئة
```bash
cp .env.example .env
```

قم بتحرير ملف `.env` وإضافة المعلومات المطلوبة:

```env
# إعدادات الخادم
PORT=3000
HOST=0.0.0.0
NODE_ENV=production

# إعدادات Easy Order API (مطلوب)
EASY_ORDER_API_URL=https://your-easyorder-domain.com/api
EASY_ORDER_API_KEY=your-api-key-here

# إعدادات اختيارية
WHATSAPP_SESSION_ID=auto-service-bot
API_SECRET=your-secret-key
AUTO_CLEANUP_HOURS=24
MAX_PENDING_ORDERS=1000
```

### 4. تشغيل البوت
```bash
# للتطوير
npm run dev

# للإنتاج
npm start
```

## كيفية الاستخدام

### 1. ربط واتساب
1. افتح المتصفح واذهب إلى `http://localhost:3000`
2. امسح رمز QR باستخدام واتساب
3. انتظر حتى يظهر "متصل ويعمل بنجاح"

### 2. إرسال طلب من Easy Order
أرسل طلب POST إلى `/send-order` مع البيانات التالية:

```json
{
  "order_id": "12345",
  "customer_name": "أحمد محمد",
  "customer_phone": "201234567890",
  "total": 250,
  "address": "القاهرة، مصر الجديدة",
  "items": [
    {
      "name": "منتج 1",
      "price": 100,
      "quantity": 1
    },
    {
      "name": "منتج 2", 
      "price": 150,
      "quantity": 1
    }
  ]
}
```

### 3. معالجة ردود العملاء
البوت يتعامل تلقائياً مع:
- الضغط على أزرار التأكيد/الإلغاء
- الردود النصية (موافق، تأكيد، إلغاء، رفض)
- تحديث حالة الطلب في Easy Order

## API Endpoints

### الأساسية
- `GET /` - الصفحة الرئيسية وحالة البوت
- `GET /health` - فحص صحة الخادم
- `POST /send-order` - إرسال طلب جديد
- `GET /pending-orders` - عرض الطلبات المعلقة

### الإدارة
- `POST /restart` - إعادة تشغيل البوت
- `POST /cleanup` - تنظيف الطلبات المنتهية الصلاحية
- `POST /broadcast` - إرسال رسالة جماعية
- `GET /stats` - إحصائيات مفصلة

### الاختبار
- `POST /test-send` - إرسال رسالة تجريبية
- `POST /cancel-order/:orderId` - إلغاء طلب معين

## هيكل المشروع

```
whatsapp-bot/
├── improved-bot.js          # الملف الرئيسي للبوت
├── easyorder-api.js         # معالج Easy Order API
├── test-bot.js              # اختبارات البوت
├── test-easyorder.js        # اختبارات Easy Order API
├── package.json             # معلومات المشروع
├── .env.example             # مثال على متغيرات البيئة
├── README.md                # هذا الملف
├── auth_info/               # بيانات تسجيل دخول واتساب
├── *.log                    # ملفات السجلات
├── *_backup.json            # نسخ احتياطية
└── failed_updates.json      # الطلبات الفاشلة
```

## الاختبار

### اختبار البوت
```bash
node test-bot.js
```

### اختبار Easy Order API
```bash
node test-easyorder.js
```

### اختبار مستمر
```bash
node test-bot.js --continuous 60000  # اختبار لمدة دقيقة
```

## استكشاف الأخطاء

### مشاكل شائعة

#### 1. البوت لا يتصل بواتساب
- تأكد من مسح رمز QR بشكل صحيح
- تحقق من اتصال الإنترنت
- امسح مجلد `auth_info` وأعد المحاولة

#### 2. فشل في إرسال الرسائل
- تأكد من أن البوت متصل (حالة "متصل")
- تحقق من صحة رقم الهاتف
- راجع ملف `bot.log` للأخطاء

#### 3. فشل تحديث Easy Order
- تحقق من صحة `EASY_ORDER_API_URL` و `EASY_ORDER_API_KEY`
- راجع ملف `failed_updates.json` للطلبات الفاشلة
- استخدم `node test-easyorder.js` لاختبار الاتصال

### ملفات السجلات
- `bot.log` - سجل البوت الرئيسي
- `successful_updates.json` - التحديثات الناجحة
- `failed_updates.json` - التحديثات الفاشلة
- `bot_test_report.json` - تقرير الاختبارات
- `easyorder_test_report.json` - تقرير اختبار Easy Order

## التكامل مع Easy Order

### متطلبات API
البوت يحتاج إلى:
1. **URL الأساسي** لـ Easy Order API
2. **مفتاح API** للمصادقة
3. **Endpoint** لتحديث حالة الطلب

### Endpoints المدعومة
البوت يجرب تلقائياً عدة endpoints:
- `/orders/{orderId}/update-status`
- `/orders/{orderId}/status`
- `/order/update/{orderId}`
- `/webhook/order-status`
- `/api/orders/{orderId}/status`
- `/v1/orders/{orderId}/update`

### بيانات التحديث المرسلة
```json
{
  "order_id": "12345",
  "status": "confirmed", // أو "cancelled"
  "updated_at": "2023-12-01T10:00:00.000Z",
  "notes": "تم تأكيد الطلب عبر WhatsApp Bot",
  "customer_phone": "201234567890",
  "customer_name": "أحمد محمد",
  "bot_version": "3.0",
  "source": "whatsapp_bot"
}
```

## الأمان

### أفضل الممارسات
- احتفظ بـ `EASY_ORDER_API_KEY` سرياً
- استخدم HTTPS في الإنتاج
- راقب ملفات السجلات بانتظام
- قم بعمل نسخ احتياطية من `auth_info`

### متغيرات البيئة الحساسة
```env
EASY_ORDER_API_KEY=your-secret-key
API_SECRET=webhook-secret
EASY_ORDER_WEBHOOK_SECRET=another-secret
```

## النشر

### على خادم محلي
```bash
# تثبيت PM2 لإدارة العمليات
npm install -g pm2

# تشغيل البوت
pm2 start improved-bot.js --name whatsapp-bot

# مراقبة البوت
pm2 monit
```

### على السحابة
1. رفع الملفات إلى الخادم
2. تثبيت المتطلبات: `npm install`
3. إعداد متغيرات البيئة
4. تشغيل البوت: `npm start`

## المساهمة

### إضافة مميزات جديدة
1. Fork المشروع
2. إنشاء branch جديد
3. إضافة التحسينات
4. إرسال Pull Request

### الإبلاغ عن مشاكل
استخدم GitHub Issues مع:
- وصف المشكلة
- خطوات إعادة الإنتاج
- ملفات السجلات ذات الصلة

## الترخيص

MIT License - راجع ملف LICENSE للتفاصيل

## الدعم

للحصول على الدعم:
1. راجع هذا الدليل أولاً
2. تحقق من ملفات السجلات
3. جرب سكريبتات الاختبار
4. اتصل بفريق التطوير

---

**ملاحظة**: هذا البوت مصمم خصيصاً للتكامل مع Easy Order. قد تحتاج إلى تعديلات للعمل مع أنظمة أخرى.