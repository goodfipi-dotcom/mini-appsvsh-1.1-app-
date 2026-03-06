import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const BOT_TOKEN = process.env.TELEGRAM_TOKEN;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { service, address, comment, client_price, worker_price, margin, workers_needed } = req.body;

  try {
    // 1. ЗАПИСЬ В БАЗУ
    const { data: order, error: dbError } = await supabase
      .from('orders')
      .insert([{
        task: service,
        address: address,
        comment: comment,
        client_price: client_price,
        worker_price: worker_price,
        margin: margin,
        workers_needed: workers_needed,
        status: 'published'
      }])
      .select().single();

    if (dbError) throw dbError;

    // 2. ПОЛУЧАЕМ ВСЕХ РАБОЧИХ ДЛЯ РАССЫЛКИ
    const { data: workers } = await supabase.from('workers').select('id').eq('is_banned', false);

    // 3. РАССЫЛКА ПУШЕЙ В ТЕЛЕГРАМ
    if (workers && workers.length > 0) {
      const message = `🛠 **НОВЫЙ ЗАКАЗ!**\n\n` +
                      `📝 Задача: ${service}\n` +
                      `📍 Адрес: ${address}\n` +
                      `💰 Оплата: **${worker_price} ₽/час**\n` +
                      `👥 Нужно: ${workers_needed} чел.\n\n` +
                      `Заходи в приложение, чтобы принять!`;

      // Рассылаем всем одновременно
      await Promise.all(workers.map(w => 
        fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: w.id,
            text: message,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[{ text: "🚀 ОТКРЫТЬ ЗАКАЗЫ", url: "https://t.me/ТВОЙ_БОТ_БЕЗ_СОБАЧКИ/app" }]]
            }
          })
        })
      ));
    }

    return res.status(200).json({ success: true, order_id: order.id });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
