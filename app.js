const express = require('express');
const session = require('express-session');
const path = require('path');
const authMiddleware = require('./middlewares/auth');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({ secret: 'secret', resave: false, saveUninitialized: true }));

app.use('/admin', authMiddleware.ensureAdmin, require('./routes/admin'));
app.use('/user', authMiddleware.ensureUser, require('./routes/user'));

app.get('/login', (req, res) => res.render('login'));
app.post('/login', require('./routes/user').login);
app.get('/login', (req, res) => {
  console.log('Reached GET /login');
  res.render('login');
});
app.post('/login', require('./routes/user').login);
app.get('/dashboard', authMiddleware.ensureUser, (req, res) => res.redirect('/user/dashboard'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
