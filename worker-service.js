const express = require('express');
const bodyParser = require('body-parser');
const mineflayer = require('mineflayer');
// Убедитесь, что эта строка удалена: // const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 10000;

// ======================================================================
// --- КОНФИГУРАЦИЯ БОТА И API ---
// ⚠️ ЗАМЕНИТЕ ЭТОТ ТОКЕН НА ТОКЕН ВАШЕГО ТЕЛЕГРАМ-БОТА
const TELEGRAM_TOKEN = '8596622001:AAE7NxgyUEQ-mZqTMolt7Kgs2ouM0QyjdIE'; 
const BASE_TELEGRAM_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
// ======================================================================


// --- КОНФИГУРАЦИЯ ПРОКСИ ---
// ✅ СПИСОК ВАШИХ SOCKS5 ПРОКСИ
const PROXY_LIST = [
    { host: '85.172.55.85', port: 1080 },
    { host: '84.252.70.254', port: 1080 },
    { host: '95.78.119.94', port: 1080 },
    { host: '195.91.129.101', port: 1337 },
    { host: '85.113.43.181', port: 1080 },
    { host: '217.173.31.28', port: 1080 },
    { host: '78.29.46.43', port: 1080 },
    { host: '87.117.39.250', port: 1080 },
    { host: '31.129.147.102', port: 1080 },
    { host: '78.140.46.48', port: 1080 },
    { host: '31.43.194.184', port: 1080 },
];
// --- КОНЕЦ КОНФИГУРАЦИИ ПРОКСИ ---

const activeBots = {}; // Хранит состояние активных ботов

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
        
        // 2. ЗАПАСНОЙ ВАРИАНТ
        if (!response.ok && response.status === 400) {
            console.warn(`[Chat ${chatId}] Ошибка MarkdownV2, отправляю обычный текст.`);
            const plainPayload = {
                chat_id: chatId,
                text: `[RAW] ${message}` 
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

// --- ОСНОВНАЯ ЛОГИКА MINEFLAYER С РОТАЦИЕЙ ПРОКСИ ---

function setupMineflayerBot(chatId, host, port, username) {
    const maxAttempts = 5; // Максимальное количество попыток для стандартного реконнекта

    // 1. Инициализация/Обновление состояния
    let data = activeBots[chatId];
    if (data && data.bot) {
        console.log(`[Chat ${chatId}] Обнаружен старый бот. Отключаю: ${data.host}:${data.port}`);
        data.bot.quit('disconnect.cleanup'); // Отключаем старый, чтобы не мешал
        data.bot = null; // Обнуляем ссылку
    }

    if (!data) {
        // Инициализация нового сеанса
        data = { bot: null, host, port, username, reconnectAttempts: 0, currentProxyIndex: 0, isProxyFailure: false };
        activeBots[chatId] = data;
    } else {
        // Обновление данных сеанса (если был /start)
        data.host = host;
        data.port = port;
        data.username = username;
        // При явном запуске команды /start сбрасываем попытки и индекс прокси
        if (data.reconnectAttempts === 0) {
             data.currentProxyIndex = 0; 
        }
        data.bot = null;
    }


    // 2. Проверка прокси
    const currentIndex = data.currentProxyIndex;
    if (currentIndex >= PROXY_LIST.length) {
        console.log(`[Chat ${chatId}] Все ${PROXY_LIST.length} прокси были испробованы. Отключение.`);
        sendNotification(chatId, `🛑 Бот отключен окончательно. Все ${PROXY_LIST.length} прокси были испробованы.`);
        cleanupBot(chatId);
        return;
    }

    const currentProxy = PROXY_LIST[currentIndex];
    
    // 📢 КРИТИЧЕСКОЕ ЛОГИРОВАНИЕ 📢
    console.log(`[Chat ${chatId}] Запуск Mineflayer с: Host=${host}, Port=${port}, Username=${username} | ПРОКСИ: ${currentProxy.host}:${currentProxy.port} (№${currentIndex + 1}/${PROXY_LIST.length})`);

    // 3. Создание бота
    const bot = mineflayer.createBot({
        host: host, 
        port: parseInt(port), 
        username: username,
        version: '1.20.1', 
        
        proxy: {
            host: currentProxy.host,
            port: currentProxy.port,
            type: 5 // SOCKS5
        }
    });

    data.bot = bot; // Сохраняем ссылку на новый бот
    
    // --- ОБРАБОТЧИКИ СОБЫТИЙ MINEFLAYER ---

    bot.on('login', () => {
        console.log(`[Chat ${chatId}] Бот ${username} подключился к ${host}:${port}`);
        sendNotification(chatId, `✅ Бот ${username} успешно подключился к ${host}:${port}`);
        
        if (activeBots[chatId]) {
            activeBots[chatId].reconnectAttempts = 0; // Сброс попыток при успехе
            activeBots[chatId].currentProxyIndex = 0; // Сброс индекса при успехе
        }
    });

    bot.on('error', (err) => {
        const errorMessage = err.message || 'Неизвестная ошибка подключения';
        console.error(`[Chat ${chatId}] Ошибка бота: ${errorMessage}`);
        sendNotification(chatId, `❌ Критическая ошибка: ${errorMessage}`);
        
        const data = activeBots[chatId];
        if (data) {
            // Если ошибка связана с прокси/сетью (ECONNRESET, ETIMEDOUT), ставим флаг для ротации
            if (errorMessage.includes('ECONNRESET') || errorMessage.includes('ETIMEDOUT')) {
                data.isProxyFailure = true;
            }
            data.bot.quit('disconnect.error'); // Триггерим событие 'end'
        }
    });

    bot.on('end', (reason) => {
        console.log(`[Chat ${chatId}] Бот отключен. Причина: ${reason}`);
        
        const data = activeBots[chatId];
        if (!data) return cleanupBot(chatId);

        // 1. Специальные причины для немедленного выхода
        if (reason === 'disconnect.quitting' || reason === 'disconnect.cleanup') {
            sendNotification(chatId, `⏹ Бот остановлен по команде.`);
            return cleanupBot(chatId);
        }

        // 2. Логика ротации прокси (срабатывает после ошибки подключения)
        if (data.isProxyFailure) {
            data.isProxyFailure = false; // Сброс флага
            data.currentProxyIndex++;     // Переходим к следующему прокси
            
            if (data.currentProxyIndex < PROXY_LIST.length) {
                const nextProxyIndex = data.currentProxyIndex;
                sendNotification(chatId, `⚠️ Прокси не сработал. Попытка переподключения с ПРОКСИ №${nextProxyIndex + 1}/${PROXY_LIST.length}.`);

                setTimeout(() => {
                    console.log(`[Chat ${chatId}] Попытка переподключения с новым прокси...`);
                    // Рекурсивный вызов, который возьмет новый индекс прокси из data.currentProxyIndex
                    setupMineflayerBot(chatId, data.host, data.port, data.username); 
                }, 5000);
                return; 
            } else {
                 // Все прокси исчерпаны
                sendNotification(chatId, `🛑 Бот отключен окончательно. Все ${PROXY_LIST.length} прокси были испробованы.`);
                return cleanupBot(chatId);
            }
        }
        
        // 3. Стандартный реконнект (для киков, таймаутов и т.п.)
        data.reconnectAttempts++;

        if (data.reconnectAttempts < maxAttempts) {
            sendNotification(chatId, `⚠️ Бот был отключен (${reason}). Попытка переподключения (${data.reconnectAttempts}/${maxAttempts})...`);
            
            setTimeout(() => {
                console.log(`[Chat ${chatId}] Попытка переподключения...`);
                // Рекурсивный вызов, сохраняем текущий прокси
                setupMineflayerBot(chatId, data.host, data.port, data.username); 
            }, 5000 * data.reconnectAttempts); 
        } else {
            sendNotification(chatId, `🛑 Бот отключен окончательно (${reason}). Достигнут лимит попыток переподключения.`);
            cleanupBot(chatId);
        }
    });
    
    bot.on('spawn', () => {
        console.log(`[Chat ${chatId}] Бот заспавнился. Готов к работе.`);
        sendNotification(chatId, `🌍 Бот заспавнился и готов к работе.`);
    });
}


// --- API ЭНДПОИНТЫ (Без изменений) ---

// /api/start
app.post('/api/start', (req, res) => {
    const { chatId, host, port, username } = req.body;
    // ... (проверка параметров)
    if (!chatId || !host || !port || !username) {
        return res.status(400).send({ error: "Missing required parameters: chatId, host, port, or username." });
    }
    
    try {
        // При явном вызове сбрасываем счетчики, чтобы начать с первого прокси
        if (activeBots[chatId]) {
            activeBots[chatId].reconnectAttempts = 0;
            activeBots[chatId].currentProxyIndex = 0;
        }
        setupMineflayerBot(chatId, host, port, username);
        res.status(200).send({ message: "Bot start command received." });
    } catch (e) {
        res.status(500).send({ error: e.message });
    }
});

// /api/stop
app.post('/api/stop', (req, res) => {
    const { chatId } = req.body;
    if (!chatId) {
        return res.status(400).send({ error: "Missing required parameter: chatId." });
    }

    if (activeBots[chatId] && activeBots[chatId].bot) {
        activeBots[chatId].bot.quit('disconnect.quitting');
        res.status(200).send({ message: "Bot stop command received. Disconnecting." });
    } else {
        res.status(404).send({ message: "Bot not found or not running for this chat." });
        cleanupBot(chatId); // Просто очистим, если был только объект состояния
    }
});


// /api/command
app.post('/api/command', (req, res) => {
    const { chatId, command } = req.body;
    
    if (!chatId || !command) {
        return res.status(400).send({ error: "Missing required parameters: chatId or command." });
    }

    if (activeBots[chatId] && activeBots[chatId].bot) {
        try {
            activeBots[chatId].bot.chat(command);
            res.status(200).send({ message: `Command '${command}' sent to bot.` });
        } catch (e) {
            console.error(`[Chat ${chatId}] Failed to send command: ${e.message}`);
            res.status(500).send({ error: `Failed to send command: ${e.message}` });
        }
    } else {
        res.status(404).send({ message: "Bot not found or not running." });
    }
});


// --- ЗАПУСК СЕРВЕРА ---
app.listen(PORT, () => {
    console.log(`Worker service running on port ${PORT}`);
});
