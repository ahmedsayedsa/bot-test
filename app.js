const express = require('express');
const session = require('express-session');
const path = require('path');
const authMiddleware = require('./middlewares/auth');

const app = express();

// إعدادات Body Parser لفك ترميز الـ form data
app.use(express.urlencoded({ extended: false }));

// ملفات الـ CSS، JS، الصور في مجلد public (Static Files)
app.use(express.static(path.join(__dirname, 'public')));

// إعداد EJS كـ view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// إعداد الجلسات (Sessions)
app.use(session({
  secret: 'secret',            // استبدلها بسلسلة سرية قوية في مشروع حقيقي
  resave: false,
  saveUninitialized: true
}));

// استدعاء Routes
// - صفحة تسجيل الدخول (login)
app.get('/login', (req, res) => {
  console.log('Reached GET /login');
  res.render('login', { error: null });
});
app.post('/login', require('./routes/user').login);

// - صفحة Dashboard للمستخدم (تحتاج تسجيل دخول)
app.get('/dashboard', authMiddleware.ensureUser, (req, res) => {
  res.redirect('/user/dashboard');
});

// - إدارة العملاء (تحتاج صلاحيات أدمن)
app.use('/admin', authMiddleware.ensureAdmin, require('./routes/admin'));

// - صفحة المستخدم (تحتاج تسجيل دخول)
app.use('/user', authMiddleware.ensureUser, require('./routes/user'));

// صفحة رئيسية (اختياري)
app.get('/', (req, res) => {
  res.redirect('/login');
});

// بدء السيرفر
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
