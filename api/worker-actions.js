import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { action, worker_id, bank_details, stars } = req.body;

    if (action === 'save_details') {
      if (!worker_id) return res.status(400).json({ error: 'Missing worker_id' });
      await pool.query(
        'UPDATE workers SET bank_details = $1 WHERE id = $2',
        [bank_details || '', String(worker_id)]
      );
      return res.status(200).json({ success: true });
    }

    if (action === 'give_stars') {
      if (!worker_id || !stars) return res.status(400).json({ error: 'Missing worker_id or stars' });
      const result = await pool.query(
        'UPDATE workers SET stars = stars + $1 WHERE id = $2 RETURNING stars',
        [parseInt(stars), String(worker_id)]
      );
      if (result.rowCount === 0) return res.status(404).json({ error: 'Worker not found' });
      return res.status(200).json({ success: true, newTotal: result.rows[0].stars });
    }

    // accept_order перенесён в /api/order.js для атомарной блокировки
    if (action === 'accept_order') {
      return res.status(301).json({ error: 'Use POST /api/order with action: accept_order' });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('Worker actions error:', err);
    return res.status(500).json({ error: err.message });
  }
}
