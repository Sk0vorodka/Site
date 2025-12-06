const express = require('express');
const bodyParser = require('body-parser');
const mineflayer = require('mineflayer');
// Убедитесь, что эта строка удалена: // const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 10000;

// ⚠️ ЗАМЕНИТЕ ЭТОТ ТОКЕН НА ТОКЕН ВАШЕГО ТЕЛЕГРАМ-БОТА
const TELEGRAM_TOKEN = '8596622001:AAE7NxgyUEQ-mZqTMolt7Kgs2ouM0QyjdIE'; 
const BASE_TELEGRAM_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// --- НАСТРОЙКИ ПРОКСИ ---
// 🟢 ИСПОЛЬЗУЕМ ВАШ ДОМЕН ДЛЯ ОБХОДА БЛОКИРОВКИ ATernos
const PROXY_HOST = 'router.comss.one'; 
const PROXY_PORT = 1080; 
// --- КОНЕЦ НАСТРОЕК ПРОКСИ ---

const activeBots = {};

// --- КОНФИГУРАЦИЯ EXPRESS ---
app.use(bodyParser.json());

app.get('/', (req, res) => {
    res.send('Worker API is running. Use /api/start or /api/stop.');
});

// --- ФУНКЦИИ УВЕДОМЛЕНИЙ ---

async function sendNotification(chatId, message) {
    // 🟢 ИСПРАВЛЕНИЕ: Динамический импорт для node-fetch v3
    try {
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
    if (activeBots[chatId] && activeBots[chatId].bot) {
        activeBots[chatId].bot.quit('disconnect.cleanup'); 
    }
    
    // 🟢 НАСТРОЙКА MINEFLAYER С ПРОКСИ
    const bot = mineflayer.createBot({
        host: host, 
        port: parseInt(port), 
        username: username,
        version: '1.20.1', 
        
        // --- ПАРАМЕТРЫ ПРОКСИ ---
        proxy: {
            host: PROXY_HOST,
            port: PROXY_PORT,
            type: 5 // SOCKS5
        }
    });

    activeBots[chatId] = { bot, host, port, username, reconnectAttempts: 0 };
    const maxAttempts = 5;

    // --- ОБРАБОТЧИКИ СОБЫТИЙ MINEFLAYER ---

    bot.on('login', () => {
        console.log(`[Chat ${chatId}] Бот ${username} подключился к ${host}:${port}`);
        sendNotification(chatId, `✅ Бот \\*${username}\\* успешно подключился к \\*${host}:${port}\\*`);
        activeBots[chatId].reconnectAttempts = 0; 
    });

    bot.on('error', (err) => {
        const errorMessage = err.message || 'Неизвестная ошибка подключения';
        console.error(`[Chat ${chatId}] Ошибка бота: ${errorMessage}`);
        sendNotification(chatId, `❌ Критическая ошибка: \\*${errorMessage}\\*`);
        
        if (activeBots[chatId] && activeBots[chatId].bot) {
             activeBots[chatId].bot.quit('disconnect.error'); 
        }
    });

    bot.on('end', (reason) => {
        console.log(`[Chat ${chatId}] Бот отключен. Причина: ${reason}`);
        
        if (reason === 'disconnect.quitting') {
            sendNotification(chatId, `⏹ Бот остановлен по команде.`);
            cleanupBot(chatId);
            return; 
        }
        
        if (reason === 'disconnect.cleanup') {
            cleanupBot(chatId);
            return; 
        }
        
        if (activeBots[chatId] && activeBots[chatId].reconnectAttempts < maxAttempts) {
            activeBots[chatId].reconnectAttempts++;
            sendNotification(chatId, `⚠️ Бот был отключен \\(${reason}\\)\\. Попытка переподключения \\(${activeBots[chatId].reconnectAttempts}/${maxAttempts}\\)\\.`);
            
            setTimeout(() => {
                console.log(`[Chat ${chatId}] Попытка переподключения...`);
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
