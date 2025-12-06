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
// Используется для обхода блокировки Aternos (требует 'socks-client')
const PROXY_HOST = 'router.comss.one'; 
const PROXY_PORT = 1080; 
// --- КОНЕЦ НАСТРОЕК ПРОКСИ ---

const activeBots = {};

// --- КОНФИГУРАЦИЯ EXPRESS ---
app.use(bodyParser.json());

app.get('/', (req, res) => {
    res.send('Worker API is running. Use /api/start, /api/stop, or /api/command.');
});

// --- ФУНКЦИИ УВЕДОМЛЕНИЙ ---

async function sendNotification(chatId, message) {
    // Динамический импорт для node-fetch v3
    try {
        const { default: fetch } = await import('node-fetch'); 

        if (!TELEGRAM_TOKEN) {
            console.error(`[Chat ${chatId}] Ошибка: TELEGRAM_TOKEN не установлен.`);
            return;
        }
        
        // 1. Попытка отправить с MarkdownV2 (с полным экранированием)
        // Экранируем: _ * [ ] ( ) ~ ` > # + - = | { } . !
        const escapedMessage = message.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');

        const url = `${BASE_TELEGRAM_URL}/sendMessage`;
        const payload = {
            chat_id: chatId,
            text: escapedMessage,
            parse_mode: 'MarkdownV2'
        };

        let response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        // 2. ЗАПАСНОЙ ВАРИАНТ: Если MarkdownV2 не прошел (ошибка 400), отправляем чистый текст
        if (!response.ok && response.status === 400) {
            console.warn(`[Chat ${chatId}] Ошибка MarkdownV2, отправляю обычный текст.`);
            const plainPayload = {
                chat_id: chatId,
                text: `[RAW] ${message}` // Отправляем оригинальное сообщение без форматирования
            };
            response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(plainPayload)
            });
        }

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
    
    // НАСТРОЙКА MINEFLAYER С ПРОКСИ
    const bot = mineflayer.createBot({
        host: host, 
        port: parseInt(port), 
        username: username,
        version: '1.20.1', 
        
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
        sendNotification(chatId, `✅ Бот ${username} успешно подключился к ${host}:${port}`);
        
        // Проверка на существование объекта перед сбросом счетчика
        if (activeBots[chatId]) {
            activeBots[chatId].reconnectAttempts = 0; 
        }
    });

    bot.on('error', (err) => {
        const errorMessage = err.message || 'Неизвестная ошибка подключения';
        console.error(`[Chat ${chatId}] Ошибка бота: ${errorMessage}`);
        sendNotification(chatId, `❌ Критическая ошибка: ${errorMessage}`);
        
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
            sendNotification(chatId, `⚠️ Бот был отключен (${reason}). Попытка переподключения (${activeBots[chatId].reconnectAttempts}/${maxAttempts})...`);
            
            setTimeout(() => {
                console.log(`[Chat ${chatId}] Попытка переподключения...`);
                setupMineflayerBot(chatId, host, port, username); 
            }, 5000 * activeBots[chatId].reconnectAttempts); 
        } else {
            sendNotification(chatId, `🛑 Бот отключен окончательно (${reason}). Достигнут лимит попыток переподключения. Снова запустите через Telegram.`);
            cleanupBot(chatId);
        }
    });
    
    bot.on('spawn', () => {
        console.log(`[Chat ${chatId}] Бот заспавнился. Готов к работе.`);
        sendNotification(chatId, `🌍 Бот заспавнился и готов к работе.`);
    });
}


// --- API ЭНДПОИНТЫ ---

// /api/start
app.post('/api/start', (req, res) => {
    const { chatId, host, port, username } = req.body;
    // ... (проверка параметров)
    try {
        setupMineflayerBot(chatId, host, port, username);
        res.status(200).send({ message: "Bot start command received." });
    } catch (e) {
        res.status(500).send({ error: e.message });
    }
});


// /api/stop
app.post('/api/stop', (req, res) => {
    const { chatId } = req.body;
    // ... (проверка параметров)
    if (activeBots[chatId] && activeBots[chatId].bot) {
        activeBots[chatId].bot.quit('disconnect.quitting'); 
        res.status(200).send({ message: "Bot stop command sent." });
    } else {
        cleanupBot(chatId);
        res.status(200).send({ message: "Bot is already stopped or not running." });
    }
});


// /api/command
app.post('/api/command', (req, res) => {
    const { chatId, command, data } = req.body;
    // ... (проверка параметров)

    const botEntry = activeBots[chatId];
    if (!botEntry || !botEntry.bot) {
        sendNotification(chatId, `❌ Ошибка: Бот не запущен. Сначала запустите его командой /start.`);
        return res.status(404).send({ error: "Bot not running." });
    }

    try {
        const bot = botEntry.bot;

        switch (command) {
            case 'CHAT':
                if (data) {
                    bot.chat(data);
                    sendNotification(chatId, `💬 Сообщение отправлено в чат: ${data}`);
                }
                break;
            
            case 'CONSOLE':
                if (data && data.startsWith('/')) {
                    bot.chat(data); 
                    sendNotification(chatId, `⚙️ Команда отправлена на сервер: ${data}`);
                } else {
                    sendNotification(chatId, `❌ Ошибка: Команда CONSOLE должна начинаться со слэша (/)`);
                }
                break;

            case 'MOVE_FORWARD':
                bot.setControlState('forward', true);
                setTimeout(() => {
                    bot.setControlState('forward', false);
                }, 1000); 
                sendNotification(chatId, `➡️ Бот двинулся вперед на 1 секунду.`);
                break;

            default:
                sendNotification(chatId, `❓ Неизвестная команда: ${command}`);
        }

        res.status(200).send({ message: `Command ${command} executed.` });
    } catch (e) {
        res.status(500).send({ error: e.message });
    }
});


// --- ЗАПУСК СЕРВЕРА ---
app.listen(PORT, () => {
    console.log(`Worker service running on port ${PORT}`);
});
