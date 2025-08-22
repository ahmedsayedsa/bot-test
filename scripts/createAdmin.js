const bcrypt = require('bcrypt');
const db = require('../models/db');

const username = 'admin';
const password = 'Qwe@123456'; // غيّره بعدين

bcrypt.hash(password, 10, (err, hash) => {
  if (err) throw err;

  db.run(
    'INSERT INTO users (username, password, sessionId, isAdmin) VALUES (?, ?, ?, ?)',
    [username, hash, 'admin-session-id', 1],
    (err) => {
      if (err) {
        console.error('فشل إضافة الأدمن:', err.message);
      } else {
        console.log('تم إنشاء حساب الأدمن بنجاح');
      }
      process.exit();
    }
  );
});
