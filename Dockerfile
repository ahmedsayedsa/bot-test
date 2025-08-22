# استخدم Node.js
FROM node:18

# تعيين مجلد العمل
WORKDIR /usr/src/app

# نسخ ملفات package.json أولاً لتثبيت الحزم
COPY package*.json ./

# تثبيت الحزم
RUN npm install

# نسخ باقي الملفات
COPY . .

# فضح البورت (من ENV أو 3000 افتراضي)
ENV PORT=3000
EXPOSE 3000

# تشغيل السيرفر
CMD [ "node", "index.js" ]
