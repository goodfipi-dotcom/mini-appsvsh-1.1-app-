import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed');

  const { action, order_id, worker_id } = req.body;

  if (action === 'accept_order') {
    try {
      // 1. Проверяем статус
      const { data: order } = await supabase.from('orders').select('status').eq('id', order_id).single();
      if (order.status !== 'published') {
        return res.status(400).json({ success: false, error: 'Заказ уже занят' });
      }

      // 2. Обновляем заказ
      await supabase.from('orders').update({ status: 'in_progress' }).eq('id', order_id);

      // 3. Логируем в assignments
      await supabase.from('assignments').insert([{ order_id, worker_id, status: 'accepted' }]);

      return res.status(200).json({ success: true });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }
}
