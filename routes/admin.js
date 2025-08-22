const express = require('express');
const router = express.Router();
const db = require('../models/db');

function getSubscriptionStatus(client) {
  const now = new Date();
  const end = new Date(client.subscriptionEnd);
  if (now > end) return 'منتهي';
  const diff = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
  return `ساري (${diff} يوم متبقي)`;
}

router.get('/', (req, res) => {
  db.all('SELECT * FROM clients', [], (err, clients) => {
    res.render('admin-dashboard', { clients, getSubscriptionStatus });
  });
});

router.get('/client/:sessionId/customize', (req, res) => {
  const { sessionId } = req.params;
  db.get('SELECT * FROM clients WHERE sessionId = ?', [sessionId], (err, client) => {
    if (!client) return res.status(404).send('غير موجود');
    res.render('client-customize', { client });
  });
});

router.post('/client/:sessionId/customize', (req, res) => {
  const { sessionId } = req.params, { message } = req.body;
  db.run('UPDATE clients SET customMessage = ? WHERE sessionId = ?', [message, sessionId], () => {
    res.redirect('/admin');
  });
});

module.exports = router;
