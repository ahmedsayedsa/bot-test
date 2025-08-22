app.get("/admin", (req, res) => {
    const db = loadDB();
    const clientsList = db.clients.map(client => {
        const currentStatus = clientPool.get(client.sessionId)?.status || 'offline';
        const statusColor = currentStatus === 'connected' ? 'green' : 'red';
        return `
            <div class="client-card">
                <div class="client-info">
                    <span class="client-name">${client.name} (${client.phone})</span>
                    <span class="client-status" style="background-color: ${statusColor};"></span>
                </div>
                <div class="client-actions">
                    <a href="/admin/client/${client.sessionId}">إدارة الجلسة</a>
                </div>
            </div>
        `;
    }).join('');
    
    res.send(`
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>لوحة تحكم البوت</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    background-color: #f4f7f9;
                    margin: 0;
                    padding: 20px;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                }
                .container {
                    background-color: #ffffff;
                    padding: 30px;
                    border-radius: 10px;
                    box-shadow: 0 4px 8px rgba(0,0,0,0.1);
                    width: 100%;
                    max-width: 600px;
                }
                h1 {
                    color: #333;
                    text-align: center;
                }
                .client-card {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 15px;
                    margin-bottom: 15px;
                    background-color: #f9f9f9;
                    border: 1px solid #ddd;
                    border-radius: 8px;
                }
                .client-info {
                    display: flex;
                    align-items: center;
                }
                .client-name {
                    font-size: 1.1em;
                    color: #555;
                    font-weight: bold;
                }
                .client-status {
                    width: 10px;
                    height: 10px;
                    border-radius: 50%;
                    margin-left: 10px;
                }
                .client-actions a {
                    text-decoration: none;
                    color: #007bff;
                    font-weight: bold;
                }
                .add-client-btn {
                    display: block;
                    width: 100%;
                    padding: 10px;
                    text-align: center;
                    background-color: #007bff;
                    color: white;
                    border-radius: 8px;
                    text-decoration: none;
                    font-weight: bold;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>لوحة تحكم البوت</h1>
                <h2>العملاء المسجلون</h2>
                ${clientsList}
                <a href="/admin/new" class="add-client-btn">➕ إضافة عميل جديد</a>
            </div>
        </body>
        </html>
    `);
});

app.get('/admin/client/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const db = loadDB();
    const client = db.clients.find(c => c.sessionId === sessionId);
    
    if (!client) {
        return res.status(404).send('العميل غير موجود.');
    }
    
    const clientData = clientPool.get(sessionId);
    const clientStatus = clientData?.status || 'offline';
    
    let qrCodeHtml = '<span>لا يوجد QR code حالياً.</span>';
    if (clientStatus === 'awaiting_qr_scan' && client.qrCodeData) {
        qrCodeHtml = `<img src="${client.qrCodeData}" alt="QR Code">`;
    }
    
    res.send(`
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>إدارة العميل - ${client.name}</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    background-color: #f4f7f9;
                    margin: 0;
                    padding: 20px;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                }
                .container {
                    background-color: #ffffff;
                    padding: 30px;
                    border-radius: 10px;
                    box-shadow: 0 4px 8px rgba(0,0,0,0.1);
                    width: 100%;
                    max-width: 600px;
                    text-align: center;
                }
                h1 {
                    color: #333;
                }
                .status-info {
                    font-size: 1.1em;
                    color: #555;
                }
                .status-info strong {
                    color: #007bff;
                }
                img {
                    border: 4px solid #ddd;
                    border-radius: 10px;
                    margin-top: 20px;
                    max-width: 100%;
                    height: auto;
                }
                .actions-form {
                    display: inline-block;
                    margin: 10px;
                }
                .actions-form button {
                    background-color: #007bff;
                    color: white;
                    border: none;
                    padding: 10px 20px;
                    border-radius: 5px;
                    cursor: pointer;
                    font-weight: bold;
                }
                .actions-form button:hover {
                    background-color: #0056b3;
                }
                .actions-form button[disabled] {
                    background-color: #cccccc;
                    cursor: not-allowed;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>إدارة العميل - ${client.name}</h1>
                <p class="status-info">رقم الهاتف: <strong>${client.phone}</strong></p>
                <p class="status-info">الحالة: <strong>${clientStatus}</strong></p>
                
                <div style="margin-top: 20px;">
                    <h2>رمز QR</h2>
                    ${qrCodeHtml}
                </div>
                
                <form class="actions-form" action="/admin/client/${sessionId}/restart" method="POST">
                    <button type="submit" ${clientStatus === 'connecting' ? 'disabled' : ''}>إعادة تشغيل البوت</button>
                </form>
                <form class="actions-form" action="/admin/client/${sessionId}/delete" method="POST" onsubmit="return confirm('هل أنت متأكد؟')">
                    <button type="submit">حذف الجلسة</button>
                </form>
                <hr>
                <form action="/admin/client/${sessionId}/customize" method="GET">
                    <button type="submit">تخصيص الرسالة</button>
                </form>
                <hr>
                <a href="/admin">العودة إلى لوحة التحكم</a>
            </div>
        </body>
        </html>
    `);
});