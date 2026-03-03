const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// Эти данные подтянутся из настроек Railway позже
const PUZZLE_API_KEY = process.env.PUZZLE_API_KEY;
const ADMIN_ID = process.env.ADMIN_ID;

app.post('/api/order', async (req, res) => {
    const orderData = req.body;
    console.log("Получен заказ:", orderData);

    try {
        // Отправляем данные в твоего бота через PuzzleBot API
        await axios.post(`https://api.puzzlebot.top/query/api/${PUZZLE_API_KEY}/sendCommand`, {
            user_id: ADMIN_ID,
            text: `🔥 НОВЫЙ ЗАКАЗ!\n\nИмя: ${orderData.name}\nАдрес: ${orderData.address}\nЗадача: ${orderData.task}\nТелефон: ${orderData.phone}`
        });
        
        res.status(200).json({ success: true });
    } catch (error) {
        console.error("Ошибка отправки:", error);
        res.status(500).json({ error: "Ошибка сервера" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Сервер VSH запущен на порту ${PORT}`));
