# استخدام Node.js الرسمي - تحديث لإصدار 20
FROM node:20-slim

# إعداد مجلد العمل
WORKDIR /app

# نسخ ملفات package
COPY package*.json ./

# تثبيت المكتبات
RUN npm install --production

# نسخ باقي الملفات
COPY . .

# إنشاء مجلد auth مسبقاً
RUN mkdir -p auth_info_session

# تعيين المنفذ
EXPOSE 5000

# متغير البيئة للمنفذ
ENV PORT=5000

# تشغيل التطبيق
CMD ["npm", "start"]