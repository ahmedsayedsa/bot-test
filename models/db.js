const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, '..', 'db.sqlite'));

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS clients (
      sessionId TEXT PRIMARY KEY,
      name TEXT,
      phone TEXT,
      subscriptionStart TEXT,
      subscriptionEnd TEXT,
      customMessage TEXT,
      qrCodeData TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      sessionId TEXT,
      isAdmin INTEGER DEFAULT 0
    )
  `);
});

module.exports = db;
