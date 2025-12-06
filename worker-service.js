// --- КОНСТАНТЫ И ИМПОРТЫ ---
const express = require('express');
const bodyParser = require('body-parser');
const mineflayer = require('mineflayer');
// Импортируем fetch, чтобы исправить "fetch is not a function"
const fetch = require('node-fetch'); 

const app = express();
const PORT = process.env.PORT || 10000; // Render требует использования PORT из env

// ⚠️ ЗАМЕНИТЕ ЭТОТ ТОКЕН НА ТОКЕН ВАШЕГО ТЕЛЕГРАМ-БОТА
const TELEGRAM_TOKEN = '8596622001:AAE7NxgyUEQ-mZqTMolt7Kgs2ouM0QyjdIE'; 
const BASE_TELEGRAM_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// Хранилище для активных ботов
const activeBots = {};

// --- КОНФИГУРАЦИЯ EXPRESS ---
app.use(bodyParser.json());

// Заглушка для основного пути
app.get('/', (req, res) => {
    res.send('Worker API is running. Use /api/start or /api/stop.');
});

// --- ФУНКЦИИ УВЕДОМЛЕНИЙ ---

async function sendNotification(chatId, message) {
    if (!TELEGRAM_TOKEN) {
        console.error(`[Chat ${chatId}] Ошибка: TELEGRAM_TOKEN не установлен.`);
        return;
    }
    
    // Экранирование символов для MarkdownV2 (важно для адресов серверов)
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
        // Логируем ошибку, которая у вас была: fetch is not a function
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
    // Если бот уже запущен, сначала останавливаем его
    if (activeBots[chatId] && activeBots[chatId].bot) {
        activeBots[chatId].bot.quit('Запуск нового соединения');
        cleanupBot(chatId);
    }
    
    // ⚠️ ГЛАВНОЕ ИСПРАВЛЕНИЕ: ЯВНО УКАЗЫВАЕМ ВЕРСИЮ
    const bot = mineflayer.createBot({
        host: host,
        port: parseInt(port),
        username: username,
        version: '1.20.1' // <--- ВАША ВЕРСИЯ
        // Если у вас premium (Mojang/Microsoft) аккаунт, добавьте:
        // auth: 'mojang' ИЛИ auth: 'microsoft'
    });

    activeBots[chatId] = { bot, host, port, username, reconnectAttempts: 0 };
    const maxAttempts = 5;

    // --- ОБРАБОТЧИКИ СОБЫТИЙ MINEFLAYER ---

    bot.on('login', () => {
        console.log(`[Chat ${chatId}] Бот ${username} подключился к ${host}:${port}`);
        sendNotification(chatId, `✅ Бот \\*${username}\\* подключился: ${host}:${port}`);
        activeBots[chatId].reconnectAttempts = 0; // Сброс при успешном входе
    });

    bot.on('error', (err) => {
        console.error(`[Chat ${chatId}] Ошибка бота: ${err.message}`);
        sendNotification(chatId, `❌ Критическая ошибка: ${err.message}`);
        
        // ВАЖНО: При ошибке завершаем процесс
        if (activeBots[chatId] && activeBots[chatId].bot) {
             activeBots[chatId].bot.quit('disconnect.error');
        }
    });

    bot.on('end', (reason) => {
        console.log(`[Chat ${chatId}] Бот отключен. Причина: ${reason}`);
        
        // Проверяем, была ли это команда на остановку от пользователя
        if (reason.includes('disconnect.quitting') && activeBots[chatId]) {
            // Если это пользовательская команда (quit), не пытаемся переподключиться
            sendNotification(chatId, `⏹ Бот остановлен по команде.`);
            cleanupBot(chatId);
            return; 
        }

        // Если бот был отключен не по команде, пытаемся переподключиться
        if (activeBots[chatId] && activeBots[chatId].reconnectAttempts < maxAttempts) {
            activeBots[chatId].reconnectAttempts++;
            sendNotification(chatId, `❌ Бот был отключен \\(${reason}\\)\\. Попытка переподключения \\(${activeBots[chatId].reconnectAttempts}/${maxAttempts}\\)\\.`);
            
            setTimeout(() => {
                console.log(`[Chat ${chatId}] Попытка переподключения...`);
                // Рекурсивный вызов для создания нового экземпляра
                setupMineflayerBot(chatId, host, port, username); 
            }, 5000 * activeBots[chatId].reconnectAttempts); // Увеличиваем задержку
        } else {
            sendNotification(chatId, `🛑 Бот отключен окончательно \\(${reason}\\)\\. Достигнут лимит попыток переподключения\\. Снова запустите через Telegram\\.`);
            cleanupBot(chatId);
        }
    });
    
    // Чтобы бот не завершался сразу после входа
    bot.on('spawn', () => {
        console.log(`[Chat ${chatId}] Бот заспавнился. Готов к работе.`);
    });
    
    // Сохраняем ссылку на созданный бот в активных ботах
    activeBots[chatId] = { bot, host, port, username, reconnectAttempts: 0 };
}


// --- API ЭНДПОИНТЫ ---

// /api/start
app.post('/api/start', (req, res) => {
    const { chatId, host, port, username } = req.body;

    if (!chatId || !host || !port || !username) {
        return res.status(400).send({ error: "Missing parameters: chatId, host, port, username." });
    }

    if (activeBots[chatId] && activeBots[chatId].bot) {
        // Если бот уже запущен, отправляем статус 200, но с сообщением
        return res.status(200).send({ message: "Bot is already running." });
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
        // cleanupBot будет вызван обработчиком 'end'
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
