const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// Test route أول
app.get('/', (req, res) => {
    res.send('<h1>السيرفر شغال!</h1><a href="/admin">Admin</a> | <a href="/user">User</a>');
});

// Admin route
app.get('/admin', (req, res) => {
    console.log('Admin route accessed');
    res.send('<h1>صفحة الادمن</h1><p>الروت شغال!</p>');
});

// User route  
app.get('/user', (req, res) => {
    console.log('User route accessed');
    res.send('<h1>صفحة اليوزر</h1><p>الروت شغال!</p>');
});

// Static files (بعد الروتس)
app.use(express.static(path.join(__dirname, 'public')));

// 404 handler
app.use('*', (req, res) => {
    res.status(404).send(`<h1>404 - الصفحة غير موجودة</h1><p>الرابط المطلوب: ${req.originalUrl}</p>`);
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`🌐 Try: http://localhost:${PORT}/admin`);
    console.log(`📁 Static files from: ${path.join(__dirname, 'public')}`);
});