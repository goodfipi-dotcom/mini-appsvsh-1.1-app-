import { createClient } from '@supabase/supabase-app'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
)

export default async function handler(req, res) {
  // Разрешаем только POST запросы
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { action, order_id, worker_id } = req.body

  try {
    if (action === 'accept_order') {
      // 1. Проверяем, не занял ли этот заказ кто-то другой, пока рабочий читал правила
      const { data: order, error: fetchError } = await supabase
        .from('orders')
        .select('status')
        .eq('id', order_id)
        .single()

      if (fetchError || !order) {
        return res.status(404).json({ success: false, error: 'Заказ не найден' })
      }

      if (order.status !== 'published') {
        return res.status(400).json({ success: false, error: 'Заказ уже кто-то забрал' })
      }

      // 2. Обновляем статус заказа и привязываем воркера
      const { error: updateError } = await supabase
        .from('orders')
        .update({ 
          status: 'accepted', 
          worker_id: worker_id,
          accepted_at: new Date().toISOString() 
        })
        .eq('id', order_id)

      if (updateError) throw updateError

      return res.status(200).json({ success: true })
    }

    // Если прилетел неизвестный action
    return res.status(400).json({ success: false, error: 'Unknown action' })

  } catch (error) {
    console.error('Worker Action Error:', error)
    return res.status(500).json({ success: false, error: 'Ошибка сервера' })
  }
}
