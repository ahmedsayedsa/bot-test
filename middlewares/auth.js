const bcrypt = require('bcrypt');
const db = require('../models/db');

exports.ensureAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.isAdmin) return next();
  res.redirect('/login');
};

exports.ensureUser = (req, res, next) => {
  if (req.session.user) return next();
  res.redirect('/login');
};
