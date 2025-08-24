const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config();

const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { Firestore } = require('@google-cloud/firestore');

// --- إعداد الخدمات ---
const app = express();
const firestore = new Firestore();
const usersCollection = firestore.collection('users'); 

// --- إعداد Express ---
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- إعداد بوت واتساب ---
const AUTH_DIR = path.join(__dirname, 'auth_info_session');
let sock = null;
let qrCode = null; 
let connectionStatus = 'disconnected';

async function startWhatsApp() {
    try {
        const fs = require('fs');
        if (!fs.existsSync(AUTH_DIR)) {
            fs.mkdirSync(AUTH_DIR, { recursive: true });
        }

        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false, 
            browser: ["Ubuntu", "Chrome", "22.04.4"],
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
            retryRequestDelayMs: 1000
        });

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                qrCode = qr; 
                console.log('QR Code generated for web display');
            }
            
            if (connection === 'open') {
                console.log('✅ WhatsApp connection opened!');
                connectionStatus = 'connected';
                qrCode = null; 
            }
            
            if (connection === 'close') {
                connectionStatus = 'disconnected';
                const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) {
                    setTimeout(startWhatsApp, 5000);
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg.message || !msg.key.remoteJid || msg.key.fromMe) return;

            const senderJid = msg.key.remoteJid;
            if (senderJid.endsWith('@g.us')) return;

            try {
                const userDoc = await usersCollection.doc(senderJid).get();

                if (!userDoc.exists) {
                    await sock.sendMessage(senderJid, { text: "أهلاً بك! أنت غير مسجل في الخدمة." });
                    return;
                }

                const userData = userDoc.data();
                const sub = userData.subscription;

                if (!sub || sub.status !== 'active' || new Date(sub.endDate.toDate()) < new Date()) {
                    await sock.sendMessage(senderJid, { text: "عذراً، اشتراكك غير فعال أو قد انتهى." });
                    return;
                }

                let welcomeMessage = userData.messageTemplate || `أهلاً {name}، اشتراكك فعال.`;
                welcomeMessage = welcomeMessage.replace(/\{name\}/g, userData.name);

                await sock.sendMessage(senderJid, { text: welcomeMessage });

            } catch (error) {
                console.error("Error processing message:", error);
            }
        });
    } catch (error) {
        console.error("Error starting WhatsApp:", error);
        setTimeout(startWhatsApp, 10000); 
    }
}

// --- مسارات API ---
app.get('/api/users', async (req, res) => {
    try {
        const snapshot = await usersCollection.get();
        const users = {};
        snapshot.forEach(doc => {
            users[doc.id] = doc.data();
        });
        res.json(users);
    } catch (error) {
        console.error("Error getting users:", error);
        res.status(500).json({ error: "Failed to get users" });
    }
});

app.post('/api/users', async (req, res) => {
    try {
        const { name, phone, status, endDate } = req.body;
        const jid = phone.replace(/\D/g, '') + '@s.whatsapp.net';
        
        const userData = {
            name,
            whatsappJid: jid,
            subscription: {
                status,
                endDate: new Date(endDate)
            }
        };
        await usersCollection.doc(jid).set(userData, { merge: true });
        res.status(200).json({ message: 'User saved successfully' });
    } catch (error) {
        console.error("Error saving user:", error);
        res.status(500).json({ error: "Failed to save user" });
    }
});

app.post('/api/template', async (req, res) => {
    try {
        const { phone, template } = req.body;
        const jid = phone.replace(/\D/g, '') + '@s.whatsapp.net';

        await usersCollection.doc(jid).set({
            messageTemplate: template
        }, { merge: true });
        res.status(200).json({ message: 'Template saved' });
    } catch (error) {
        console.error("Error saving template:", error);
        res.status(500).json({ error: "Failed to save template" });
    }
});

// --- صفحة رئيسية مع QR Code ---
app.get('/', (req, res) => {
    const qrImage = qrCode ? `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrCode)}` : null;
    
    res.send(`
        <h1>🤖 WhatsApp Bot Dashboard</h1>
        <p>Status: ${connectionStatus}</p>
        ${qrCode ? `<img src="${qrImage}" />` : '<p>No QR Available</p>'}
    `);
});

// --- صفحات الإدارة والمستخدمين ---
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/user', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'user.html'));
});

// --- تشغيل السيرفر ---
async function main() {
    try {
        await startWhatsApp();
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Server is running on http://0.0.0.0:${PORT}`);
        });
    } catch (error) {
        console.error("Error starting server:", error);
        process.exit(1);
    }
}

main().catch(console.error);
