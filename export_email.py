\
#!/usr/bin/env python3
import os, sqlite3, csv, smtplib, ssl, datetime
from email.message import EmailMessage

DB = os.environ.get('ORDERS_DB','data/orders.db')
OUT_DIR = 'data/exports'
os.makedirs(OUT_DIR, exist_ok=True)

def export_csv():
    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    cur.execute("SELECT id,name,phone,product,total,created_at FROM orders ORDER BY created_at;")
    rows = cur.fetchall()
    if not rows:
        conn.close(); return None
    fname = datetime.datetime.utcnow().strftime('orders_%Y%m%d_%H%M%S.csv')
    path = os.path.join(OUT_DIR, fname)
    with open(path, 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f); w.writerow(['id','name','phone','product','total','created_at']); w.writerows(rows)
    conn.close(); return path

def send_email_with_attachment(to_email):
    smtp_host = os.environ.get('EMAIL_SMTP_HOST'); smtp_port = int(os.environ.get('EMAIL_SMTP_PORT','587'))
    smtp_user = os.environ.get('EMAIL_SMTP_USER'); smtp_pass = os.environ.get('EMAIL_SMTP_PASS')
    if not smtp_host or not smtp_user or not smtp_pass: print('email creds missing'); return False
    csv_path = export_csv()
    if not csv_path: print('no csv'); return False
    msg = EmailMessage(); msg['Subject'] = 'Orders export '+os.path.basename(csv_path); msg['From']=smtp_user; msg['To']=to_email; msg.set_content('Attached')
    with open(csv_path,'rb') as f: data=f.read()
    msg.add_attachment(data, maintype='text', subtype='csv', filename=os.path.basename(csv_path))
    context=ssl.create_default_context()
    with smtplib.SMTP(smtp_host,smtp_port) as s:
        s.starttls(context=context); s.login(smtp_user, smtp_pass); s.send_message(msg)
    print('sent to', to_email); return True

if __name__ == '__main__':
    to = os.environ.get('SEND_TO')
    if to: send_email_with_attachment(to)
    else:
        print('Export file:', export_csv())
