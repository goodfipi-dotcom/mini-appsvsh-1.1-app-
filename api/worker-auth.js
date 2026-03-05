import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const MASTER_CODE = '2026'; // Твой новый общий код

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { telegram_id, password, first_name } = req.body;

  try {
    // 1. Проверяем, есть ли уже такой рабочий в базе
    let { data: worker } = await supabase
      .from('workers')
      .select('*')
      .eq('telegram_id', telegram_id)
      .single();

    if (worker) return res.status(200).json({ ok: true, worker });

    // 2. Если новый человек ввел мастер-код — регистрируем его
    if (password === MASTER_CODE) {
      const { data: newWorker, error: createError } = await supabase
        .from('workers')
        .insert([{ 
          name: first_name || 'Новый боец', 
          telegram_id: telegram_id,
          auth_code: MASTER_CODE,
          total_hours: 0,
          total_earnings: 0,
          rating: 5.0,
          level: 'Новичок'
        }])
        .select()
        .single();

      if (createError) throw createError;
      return res.status(200).json({ ok: true, worker: newWorker });
    }

    return res.status(401).json({ ok: false, error: 'Неверный код доступа' });

  } catch (e) {
    return res.status(500).json({ error: 'Ошибка сервера' });
  }
}
