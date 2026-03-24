import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const TG_TOKEN = process.env.TG_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const BOT_API  = `https://api.telegram.org/bot${TG_TOKEN}`;

async function sendTG(chat_id, text, reply_markup = null) {
  const payload = { chat_id, text, parse_mode: 'HTML' };
  if (reply_markup) payload.reply_markup = JSON.stringify(reply_markup);
  try {
    await fetch(`${BOT_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    console.error('TG send error:', e.message);
  }
}

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      name TEXT,
      address TEXT,
      task TEXT,
      phone TEXT,
      service TEXT,
      city TEXT DEFAULT 'Октябрьский',
      client_price INTEGER DEFAULT 0,
      worker_price INTEGER DEFAULT 0,
      margin INTEGER DEFAULT 0,
      workers_needed INTEGER DEFAULT 1,
      comment TEXT,
      status TEXT DEFAULT 'waiting_admin',
      accepted_by TEXT[] DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  const cols = await pool.query(`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'orders'
  `);
  const existing = cols.rows.map(r => r.column_name);
  if (!existing.includes('city'))  await pool.query(`ALTER TABLE orders ADD COLUMN city TEXT DEFAULT 'Октябрьский'`);
  if (!existing.includes('phone')) await pool.query(`ALTER TABLE orders ADD COLUMN phone TEXT DEFAULT ''`);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await initDB();

    // ── GET — список заказов ──
    if (req.method === 'GET') {
      const { status } = req.query;
      let query = 'SELECT * FROM orders';
      const params = [];
      if (status) {
        query += ' WHERE status = $1';
        params.push(status);
      }
      query += ' ORDER BY created_at DESC';
      const result = await pool.query(query, params);
      return res.status(200).json(result.rows);
    }

    // ── DELETE — удалить заказ (только админ) ──
    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'Missing order id' });
      await pool.query('DELETE FROM orders WHERE id = $1', [id]);
      return res.status(200).json({ success: true, deleted: id });
    }

    // ── PATCH — редактировать заказ / одобрить (админ) ──
    if (req.method === 'PATCH') {
      const { id, service, task, address, phone, city, comment, workers_needed, status } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing order id' });

      // Собираем поля для обновления
      const fields = [];
      const values = [];
      let idx = 1;

      if (service !== undefined)        { fields.push(`service = $${idx++}`);        values.push(service); }
      if (task !== undefined)            { fields.push(`task = $${idx++}`);            values.push(task); }
      if (address !== undefined)         { fields.push(`address = $${idx++}`);         values.push(address); }
      if (phone !== undefined)           { fields.push(`phone = $${idx++}`);           values.push(phone); }
      if (city !== undefined)            { fields.push(`city = $${idx++}`);            values.push(city); }
      if (comment !== undefined)         { fields.push(`comment = $${idx++}`);         values.push(comment); }
      if (workers_needed !== undefined)  { fields.push(`workers_needed = $${idx++}`);  values.push(workers_needed); }
      if (status !== undefined)          { fields.push(`status = $${idx++}`);          values.push(status); }

      if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

      values.push(id);
      const result = await pool.query(
        `UPDATE orders SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
      );

      if (result.rowCount === 0) return res.status(404).json({ error: 'Order not found' });
      return res.status(200).json({ success: true, order: result.rows[0] });
    }

    // ── POST ──
    if (req.method === 'POST') {
      const body = req.body;

      // ── Принятие заявки рабочим (атомарное — защита от двойного принятия) ──
      if (body.action === 'accept_order') {
        const { order_id, worker_id } = body;
        if (!order_id || !worker_id) {
          return res.status(400).json({ error: 'Missing order_id or worker_id' });
        }
        // UPDATE только если status = 'published' — атомарная операция
        const result = await pool.query(
          `UPDATE orders 
           SET status = 'accepted', accepted_by = array_append(accepted_by, $2::text)
           WHERE id = $1 AND status = 'published'
           RETURNING *`,
          [order_id, String(worker_id)]
        );
        if (result.rowCount === 0) {
          return res.status(409).json({ error: 'already_taken', message: 'Заявка уже принята другим рабочим' });
        }
        const order = result.rows[0];
        try {
          await sendTG(ADMIN_ID,
            `👷 <b>Заявка №${order_id} принята!</b>\n` +
            `Рабочий ID: ${worker_id}\n` +
            `🔧 ${order.service || order.task}\n📍 ${order.city}, ${order.address}`
          );
        } catch (e) {}
        return res.status(200).json({ success: true, phone: order.phone, order });
      }

      // ── Создание заказа ──
      const {
        name, address, task, phone, source, service,
        city, client_price, worker_price, margin,
        comment, workers_needed
      } = body;

      if (source === 'admin') {
        const result = await pool.query(
          `INSERT INTO orders (service, address, phone, city, client_price, worker_price, margin, workers_needed, comment, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'published') RETURNING id`,
          [service || task || '', address || '', phone || '', city || 'Октябрьский',
           client_price || 0, worker_price || 0, margin || 0, workers_needed || 1, comment || '']
        );
        return res.status(200).json({ success: true, orderId: result.rows[0].id });
      } else {
        // Заявка от заказчика (с сайта)
        const result = await pool.query(
          `INSERT INTO orders (name, address, task, phone, city, status)
           VALUES ($1,$2,$3,$4,$5,'waiting_admin') RETURNING id`,
          [name || '', address || '', task || '', phone || '', city || 'Октябрьский']
        );
        const orderId = result.rows[0].id;
        try {
          await sendTG(ADMIN_ID,
            `🔔 <b>НОВАЯ ЗАЯВКА №${orderId} С САЙТА</b>\n\n` +
            `👤 ${name}\n📍 ${city}, ${address}\n🔧 ${task}\n📞 ${phone}`,
            { inline_keyboard: [[
              { text: '✅ ОДОБРИТЬ', callback_data: `approve:${orderId}` },
              { text: '❌ ОТКЛОНИТЬ', callback_data: `reject:${orderId}` }
            ]] }
          );
        } catch (e) { console.error('Admin notify error:', e.message); }
        return res.status(200).json({ success: true, orderId });
      }
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Order API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
