# استخدام Node.js الرسمي
FROM node:18-slim

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
EXPOSE 8080

# متغير البيئة للمنفذ
ENV PORT=8080

# تشغيل التطبيق
CMD ["npm", "start"]