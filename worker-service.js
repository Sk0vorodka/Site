const express = require('express');
const bodyParser = require('body-parser');
const mineflayer = require('mineflayer');
// Важно: node-fetch версии 3+ больше не требует 'require', но мы используем его динамически.
// Убедитесь, что эта строка удалена, если она была: // const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 10000;

// ⚠️ ЗАМЕНИТЕ ЭТОТ ТОКЕН НА ТОКЕН ВАШЕГО ТЕЛЕГРАМ-БОТА
const TELEGRAM_TOKEN = '8596622001:AAE7NxgyUEQ-mZqTMolt7Kgs2ouM0QyjdIE'; 
const BASE_TELEGRAM_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// Хранилище для активных ботов
const activeBots = {};

// --- КОНФИГУРАЦИЯ EXPRESS ---
app.use(bodyParser.json());

app.get('/', (req, res) => {
    res.send('Worker API is running. Use /api/start or /api/stop.');
});

// --- ФУНКЦИИ УВЕДОМЛЕНИЙ ---

async function sendNotification(chatId, message) {
    // 🟢 ИСПРАВЛЕНИЕ #1: Динамический импорт для node-fetch v3
    const { default: fetch } = await import('node-fetch'); 

    if (!TELEGRAM_TOKEN) {
        console.error(`[Chat ${chatId}] Ошибка: TELEGRAM_TOKEN не установлен.`);
        return;
    }
    
    // Экранирование символов для MarkdownV2
    const escapedMessage = message.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');

    const url = `${BASE_TELEGRAM_URL}/sendMessage`;
    const payload = {
        chat_id: chatId,
        text: escapedMessage,
        parse_mode: 'MarkdownV2'
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) {
            console.error(`[Chat ${chatId}] Ошибка отправки уведомления: ${response.status} ${response.statusText}`);
        }
    } catch (e) {
        console.error(`[Chat ${chatId}] Критическая ошибка сети при отправке уведомления: ${e.message}`);
    }
}

function cleanupBot(chatId) {
    if (activeBots[chatId]) {
        console.log(`[Chat ${chatId}] Ресурсы бота очищены.`);
        delete activeBots[chatId];
    }
}

// --- ОСНОВНАЯ ЛОГИКА MINEFLAYER ---

function setupMineflayerBot(chatId, host, port, username) {
    // 🟢 ИСПРАВЛЕНИЕ #2: Сначала проверяем, есть ли предыдущая сессия
    let isReconnectingOrCleaning = false; 
    
    if (activeBots[chatId] && activeBots[chatId].bot) {
        // Устанавливаем флаг, чтобы не отправлять сообщение об остановке
        isReconnectingOrCleaning = true; 
        // Принудительно отключаем предыдущую сессию с особой причиной
        activeBots[chatId].bot.quit('disconnect.cleanup'); 
        // Не вызываем cleanupBot здесь, он будет вызван в обработчике 'end'
    }
    
    const bot = mineflayer.createBot({
        host: host,
        port: parseInt(port),
        username: username,
        version: '1.20.1' // Используем вашу версию
    });

    // Временно сохраняем данные, чтобы использовать их в обработчиках
    activeBots[chatId] = { bot, host, port, username, reconnectAttempts: 0 };
    const maxAttempts = 5;

    // --- ОБРАБОТЧИКИ СОБЫТИЙ MINEFLAYER ---

    bot.on('login', () => {
        console.log(`[Chat ${chatId}] Бот ${username} подключился к ${host}:${port}`);
        sendNotification(chatId, `✅ Бот \\*${username}\\* подключился к \\*${host}:${port}\\*`);
        activeBots[chatId].reconnectAttempts = 0; 
    });

    bot.on('error', (err) => {
        const errorMessage = err.message || 'Неизвестная ошибка подключения';
        console.error(`[Chat ${chatId}] Ошибка бота: ${errorMessage}`);
        sendNotification(chatId, `❌ Критическая ошибка: \\*${errorMessage}\\*`);
        
        // Завершаем процесс, чтобы обработчик 'end' инициировал переподключение
        if (activeBots[chatId] && activeBots[chatId].bot) {
             activeBots[chatId].bot.quit('disconnect.error'); 
        }
    });

    bot.on('end', (reason) => {
        console.log(`[Chat ${chatId}] Бот отключен. Причина: ${reason}`);
        
        // 🟢 ИСПРАВЛЕНИЕ #3: Обработка причин отключения
        
        // 1. Ручная остановка пользователем из Telegram
        if (reason === 'disconnect.quitting') {
            sendNotification(chatId, `⏹ Бот остановлен по команде.`);
            cleanupBot(chatId);
            return; 
        }
        
        // 2. Очистка сессии (при новой команде START)
        if (reason === 'disconnect.cleanup') {
            cleanupBot(chatId);
            return; // Не отправляем уведомление об остановке
        }
        
        // 3. Непредвиденное отключение (попытка переподключения)
        if (activeBots[chatId] && activeBots[chatId].reconnectAttempts < maxAttempts) {
            activeBots[chatId].reconnectAttempts++;
            sendNotification(chatId, `⚠️ Бот был отключен \\(${reason}\\)\\. Попытка переподключения \\(${activeBots[chatId].reconnectAttempts}/${maxAttempts}\\)\\.`);
            
            setTimeout(() => {
                console.log(`[Chat ${chatId}] Попытка переподключения...`);
                // Рекурсивный вызов для создания нового экземпляра
                setupMineflayerBot(chatId, host, port, username); 
            }, 5000 * activeBots[chatId].reconnectAttempts); 
        } else {
            sendNotification(chatId, `🛑 Бот отключен окончательно \\(${reason}\\)\\. Достигнут лимит попыток переподключения\\. Снова запустите через Telegram\\.`);
            cleanupBot(chatId);
        }
    });
    
    bot.on('spawn', () => {
        console.log(`[Chat ${chatId}] Бот заспавнился. Готов к работе.`);
    });
}


// --- API ЭНДПОИНТЫ ---

// /api/start
app.post('/api/start', (req, res) => {
    const { chatId, host, port, username } = req.body;

    if (!chatId || !host || !port || !username) {
        return res.status(400).send({ error: "Missing parameters: chatId, host, port, username." });
    }

    try {
        console.log(`[Chat ${chatId}] Получена команда START для ${host}:${port}`);
        setupMineflayerBot(chatId, host, port, username);
        res.status(200).send({ message: "Bot start command received." });
    } catch (e) {
        console.error(`[Chat ${chatId}] Ошибка при запуске: ${e.message}`);
        res.status(500).send({ error: e.message });
    }
});


// /api/stop
app.post('/api/stop', (req, res) => {
    const { chatId } = req.body;

    if (!chatId) {
        return res.status(400).send({ error: "Missing parameter: chatId." });
    }

    if (activeBots[chatId] && activeBots[chatId].bot) {
        // Используем 'disconnect.quitting' для обозначения ручной остановки
        activeBots[chatId].bot.quit('disconnect.quitting'); 
        res.status(200).send({ message: "Bot stop command sent." });
    } else {
        cleanupBot(chatId);
        res.status(200).send({ message: "Bot is already stopped or not running." });
    }
});


// --- ЗАПУСК СЕРВЕРА ---
app.listen(PORT, () => {
    console.log(`Worker service running on port ${PORT}`);
});
