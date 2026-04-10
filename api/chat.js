import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const ADMIN_ID = process.env.ADMIN_ID || '';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

async function initChatDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id SERIAL PRIMARY KEY,
      uid TEXT NOT NULL,
      name TEXT DEFAULT '',
      text TEXT DEFAULT '',
      attachment_url TEXT DEFAULT '',
      attachment_type TEXT DEFAULT '',
      edited BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

function sanitize(str) {
  if (!str) return '';
  return String(str).replace(/<[^>]*>/g, '').replace(/['"`;\\]/g, '').trim().slice(0, 1000);
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  const allowed = ['https://mini-appsvsh.vercel.app'];
  res.setHeader('Access-Control-Allow-Origin', allowed.includes(origin) ? origin : allowed[0]);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Secret');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await initChatDB();

    // ── GET — получить сообщения (последние 100) ──
    if (req.method === 'GET') {
      const { after } = req.query;
      let query = 'SELECT * FROM chat_messages';
      const params = [];

      if (after) {
        query += ' WHERE id > $1';
        params.push(parseInt(after));
      }

      query += ' ORDER BY id DESC LIMIT 100';

      const result = await pool.query(query, params);
      // Возвращаем в хронологическом порядке (старые сначала)
      return res.status(200).json({ ok: true, messages: result.rows.reverse() });
    }

    // ── POST — отправить сообщение ──
    if (req.method === 'POST') {
      const { uid, name, text, attachment_url, attachment_type, worker_id, worker_name, attachments } = req.body;

      const finalUid = uid || worker_id;
      const finalName = name || worker_name;
      if (!finalUid) return res.status(400).json({ error: 'Missing uid' });
      if (!text && !attachment_url && !(attachments && attachments.length)) return res.status(400).json({ error: 'Empty message' });

      const safeText = sanitize(text);
      const safeName = sanitize(finalName);

      // Если есть вложения — сохраняем первое (URL + тип)
      let safeUrl = sanitize(attachment_url);
      let safeType = sanitize(attachment_type);
      if (!safeUrl && attachments && attachments.length > 0) {
        safeUrl = sanitize(attachments[0].url || '');
        safeType = sanitize(attachments[0].type || '');
      }

      const result = await pool.query(
        `INSERT INTO chat_messages (uid, name, text, attachment_url, attachment_type)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [String(finalUid), safeName, safeText, safeUrl, safeType]
      );

      return res.status(200).json({ ok: true, message: result.rows[0] });
    }

    // ── PATCH — редактировать сообщение ──
    if (req.method === 'PATCH') {
      const { id } = req.query;
      const { text, uid } = req.body;

      if (!id) return res.status(400).json({ error: 'Missing id' });

      // Проверяем что это автор или админ
      const secret = req.headers['x-admin-secret'] || '';
      const isAdmin = (ADMIN_SECRET && secret === ADMIN_SECRET);

      if (!isAdmin && uid) {
        const msg = await pool.query('SELECT uid FROM chat_messages WHERE id = $1', [id]);
        if (msg.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        if (String(msg.rows[0].uid) !== String(uid)) {
          return res.status(403).json({ error: 'Not your message' });
        }
      }

      const safeText = sanitize(text);
      await pool.query(
        'UPDATE chat_messages SET text = $1, edited = TRUE WHERE id = $2',
        [safeText, id]
      );

      return res.status(200).json({ ok: true });
    }

    // ── DELETE — удалить сообщение ──
    if (req.method === 'DELETE') {
      const { id, scope } = req.query;

      if (!id) return res.status(400).json({ error: 'Missing id' });

      // scope=all — удалить для всех (автор или админ)
      // scope=me — просто возвращаем ok (скрытие на клиенте)
      if (scope === 'me') {
        return res.status(200).json({ ok: true, hidden: true });
      }

      // Удаление для всех
      const secret = req.headers['x-admin-secret'] || '';
      const isAdmin = (ADMIN_SECRET && secret === ADMIN_SECRET);

      if (!isAdmin) {
        // Проверяем авторство через body или query
        const uid = req.query.uid || '';
        if (uid) {
          const msg = await pool.query('SELECT uid FROM chat_messages WHERE id = $1', [id]);
          if (msg.rows.length > 0 && String(msg.rows[0].uid) !== String(uid)) {
            return res.status(403).json({ error: 'Not your message' });
          }
        }
      }

      await pool.query('DELETE FROM chat_messages WHERE id = $1', [id]);
      return res.status(200).json({ ok: true, deleted: id });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Chat API error:', err);
    return res.status(500).json({ error: err.message });
  }
}
