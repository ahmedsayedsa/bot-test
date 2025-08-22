const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../models/db');

// GET - صفحة لوحة تحكم المستخدم
router.get('/dashboard', (req, res) => {
  const username = req.session.user?.username;
  res.render('user_dashboard', { username });
});

// POST - تسجيل الدخول
exports.login = (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.render('login', { error: 'يرجى إدخال اسم المستخدم وكلمة المرور.' });
  }

  const sql = 'SELECT * FROM users WHERE username = ?';
  db.get(sql, [username], (err, user) => {
    if (err) {
      console.error('Database error during login:', err.message);
      return res.render('login', { error: 'حدث خطأ أثناء تسجيل الدخول.' });
    }

    if (!user) {
      return res.render('login', { error: 'المستخدم غير موجود.' });
    }

    bcrypt.compare(password, user.password, (err, result) => {
      if (err || !result) {
        return res.render('login', { error: 'كلمة المرور غير صحيحة.' });
      }

      // حفظ بيانات الجلسة
      req.session.user = {
        id: user.id,
        username: user.username,
        sessionId: user.sessionId,
        isAdmin: !!user.isAdmin
      };

      // توجيه حسب نوع المستخدم
      if (user.isAdmin) {
        return res.redirect('/admin');
      } else {
        return res.redirect('/user/dashboard');
      }
    });
  });
};

module.exports = router;
