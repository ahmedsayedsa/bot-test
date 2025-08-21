#!/bin/bash

# تلوين النصوص
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${PURPLE}🚀 إعداد Auto Service WhatsApp Bot${NC}"
echo "=================================="

# التحقق من وجود curl
if ! command -v curl &> /dev/null; then
    echo -e "${RED}❌ curl غير موجود. تثبيت curl...${NC}"
    sudo apt-get update
    sudo apt-get install -y curl
fi

# تحديث Node.js إلى الإصدار 20
echo -e "${BLUE}📦 تحديث Node.js إلى الإصدار 20...${NC}"
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# التحقق من الإصدارات
NODE_VERSION=$(node --version)
NPM_VERSION=$(npm --version)
echo -e "${GREEN}✅ إصدار Node.js: $NODE_VERSION${NC}"
echo -e "${GREEN}✅ إصدار npm: $NPM_VERSION${NC}"

# التحقق من متطلبات الإصدار
NODE_MAJOR=$(echo $NODE_VERSION | cut -d'.' -f1 | sed 's/v//')
if [ "$NODE_MAJOR" -lt "20" ]; then
    echo -e "${RED}❌ خطأ: يتطلب Node.js 20 أو أحدث${NC}"
    exit 1
fi

# مسح الملفات القديمة
echo -e "${YELLOW}🧹 تنظيف المشروع...${NC}"
rm -rf node_modules package-lock.json

# إنشاء مجلدات مطلوبة
echo -e "${CYAN}📁 إنشاء المجلدات...${NC}"
mkdir -p auth_info
mkdir -p logs
mkdir -p backups

# تثبيت المكتبات
echo -e "${BLUE}📚 تثبيت المكتبات...${NC}"
npm cache clean --force
npm install

# التحقق من التثبيت
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ تم تثبيت المكتبات بنجاح${NC}"
else
    echo -e "${RED}❌ فشل في تثبيت المكتبات${NC}"
    exit 1
fi

# إعطاء الصلاحيات
echo -e "${CYAN}🔐 ضبط الصلاحيات...${NC}"
chmod -R 755 ./
chmod +x index.js

# إنشاء ملف البيئة إذا لم يكن موجود
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}📝 إنشاء ملف البيئة (.env)...${NC}"
    cat > .env << EOF
# Auto Service WhatsApp Bot Environment Variables
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# Easy Order API Configuration
EASY_ORDER_API_URL=https://your-easyorder-domain.com/api
EASY_ORDER_API_KEY=your-api-key

# Optional: Timezone
TZ=Africa/Cairo
EOF
    echo -e "${GREEN}✅ تم إنشاء ملف .env - يرجى تعديل القيم المناسبة${NC}"
fi

# إنشاء ملف تشغيل PM2 إذا لم يكن موجود
if [ ! -f "ecosystem.config.js" ]; then
    echo -e "${YELLOW}📝 إنشاء ملف PM2...${NC}"
    cat > ecosystem.config.js << EOF
module.exports = {
  apps: [{
    name: 'auto-service-bot',
    script: './index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
};
EOF
    echo -e "${GREEN}✅ تم إنشاء ملف PM2${NC}"
fi

# إنشاء ملف gitignore
if [ ! -f ".gitignore" ]; then
    echo -e "${YELLOW}📝 إنشاء ملف .gitignore...${NC}"
    cat > .gitignore << EOF
# Logs
logs/
*.log
npm-debug.log*

# Runtime data
pids
*.pid
*.seed
*.pid.lock

# Dependencies
node_modules/

# Optional npm cache directory
.npm

# Optional REPL history
.node_repl_history

# Output of 'npm pack'
*.tgz

# Yarn Integrity file
.yarn-integrity

# dotenv environment variables file
.env

# WhatsApp auth data
auth_info/
qr.txt
pending_orders_backup.json

# PM2 logs
.pm2/
EOF
    echo -e "${GREEN}✅ تم إنشاء ملف .gitignore${NC}"
fi

# إنشاء سكريپت تشغيل سريع
cat > start.sh << EOF
#!/bin/bash
echo "🚀 بدء تشغيل Auto Service WhatsApp Bot..."
node index.js
EOF
chmod +x start.sh

echo ""
echo -e "${GREEN}✅ تم الإعداد بنجاح!${NC}"
echo ""
echo -e "${PURPLE}🔥 طرق التشغيل:${NC}"
echo -e "${CYAN}1. التشغيل العادي:${NC} node index.js"
echo -e "${CYAN}2. التشغيل السريع:${NC} ./start.sh"
echo -e "${CYAN}3. التشغيل مع PM2:${NC} npm run pm2"
echo ""
echo -e "${YELLOW}📋 الخطوات التالية:${NC}"
echo -e "1. تعديل ملف ${CYAN}.env${NC} بالإعدادات المناسبة"
echo -e "2. تشغيل البوت: ${GREEN}node index.js${NC}"
echo -e "3. مسح QR Code من الترمينال"
echo -e "4. زيارة المراقبة: ${BLUE}http://localhost:3000${NC}"
echo ""
echo -e "${GREEN}🌟 Auto Service Bot جاهز للعمل! 🌟${NC}"