const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../models/db');

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
    if (!user || !(await bcrypt.compare(password, user.password))) return res.send('بيانات غير صحيحة');
    req.session.user = user;
    res.redirect(user.isAdmin ? '/admin' : '/user/dashboard');
  });
});

router.get('/dashboard', (req, res) => {
  const client = req.session.user;
  db.get('SELECT * FROM clients WHERE sessionId = ?', [client.sessionId], (err, clientData) => {
    res.render('user-dashboard', { client: clientData });
  });
});

module.exports = router;
