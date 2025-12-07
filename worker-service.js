const express = require('express');
const bodyParser = require('body-parser');
const mineflayer = require('mineflayer');
// import node-fetch будет происходить динамически, чтобы не ломать старые версии Node.

const app = express();
const PORT = process.env.PORT || 10000;

// ======================================================================
// --- КОНФИГУРАЦИЯ БОТА И API ---
const TELEGRAM_TOKEN = '8596622001:AAE7NxgyUEQ-mZqTMolt7Kgs2ouM0QyjdIE'; 
const BASE_TELEGRAM_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
// ======================================================================


// ----------------------------------------------------------------------
// --- ⚠️ КОНФИГУРАЦИЯ ПРОКСИ-СПИСКА ---
const PROXY_LIST_URL = 'https://vpn.yzewe.ru/7822370920/2jIrFYKw89rMHoiv3HbvHg'; 
let PROXY_LIST = []; // Список будет загружен асинхронно
// --- КОНЕЦ КОНФИГУРАЦИИ ПРОКСИ ---
// ----------------------------------------------------------------------

const activeBots = {}; // Хранит состояние активных ботов

// --- КОНФИГУРАЦИЯ EXPRESS ---
app.use(bodyParser.json());

app.get('/', (req, res) => {
    res.send(`Worker API is running. Currently loaded ${PROXY_LIST.length} proxies.`);
});

// --- ФУНКЦИИ УВЕДОМЛЕНИЙ ---

async function sendNotification(chatId, message) {
    try {
        const { default: fetch } = await import('node-fetch'); 

        if (!TELEGRAM_TOKEN) {
            console.error(`[Chat ${chatId}] Ошибка: TELEGRAM_TOKEN не установлен.`);
            return;
        }
        
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

// --- ФУНКЦИИ ПАРСИНГА И ЗАГРУЗКИ ПРОКСИ ---

function parseProxyList(rawContent) {
    if (!rawContent) return [];
    
    return rawContent
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && line.includes(':'))
        .map(line => {
            const parts = line.split(':');
            return {
                host: parts[0],
                port: parseInt(parts[1])
            };
        })
        .filter(proxy => !isNaN(proxy.port));
}

[Proxy Manager] Загрузка списка прокси с внешнего URL...
[Proxy Manager] ОШИБКА при загрузке прокси-листа: Ошибка HTTP: 403 Forbidden
[Chat 7822370920] Нет доступных прокси. Отключение.


// --- ОСНОВНАЯ ЛОГИКА MINEFLAYER С РОТАЦИЕЙ ПРОКСИ ---

async function setupMineflayerBot(chatId, host, port, username) {
    const maxAttempts = 5; 

    // 0. Асинхронная загрузка списка прокси при первой необходимости
    if (PROXY_LIST.length === 0) {
        PROXY_LIST = await fetchAndParseProxyList();
        
        if (PROXY_LIST.length === 0) {
            console.log(`[Chat ${chatId}] Нет доступных прокси. Отключение.`);
            sendNotification(chatId, `🛑 Не удалось загрузить прокси-лист с ${PROXY_LIST_URL}. Проверьте URL.`);
            return cleanupBot(chatId);
        }
    }


    // 1. Инициализация/Обновление состояния
    let data = activeBots[chatId];
    if (data && data.bot) {
        console.log(`[Chat ${chatId}] Обнаружен старый бот. Отключаю: ${data.host}:${data.port}`);
        data.bot.quit('disconnect.cleanup'); 
        data.bot = null; 
    }

    if (!data) {
        data = { bot: null, host, port, username, reconnectAttempts: 0, currentProxyIndex: 0, isProxyFailure: false };
        activeBots[chatId] = data;
    } else {
        data.host = host;
        data.port = port;
        data.username = username;
        data.bot = null;
    }


    // 2. Проверка ротации
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

    data.bot = bot; 
    
    // --- ОБРАБОТЧИКИ СОБЫТИЙ MINEFLAYER ---

    bot.on('login', () => {
        console.log(`[Chat ${chatId}] Бот ${username} подключился к ${host}:${port}`);
        sendNotification(chatId, `✅ Бот ${username} успешно подключился к ${host}:${port}`);
        
        if (activeBots[chatId]) {
            activeBots[chatId].reconnectAttempts = 0; 
            activeBots[chatId].currentProxyIndex = 0; // Сброс индекса при успехе
        }
    });

    bot.on('error', (err) => {
        const errorMessage = err.message || 'Неизвестная ошибка подключения';
        console.error(`[Chat ${chatId}] Ошибка бота: ${errorMessage}`);
        // Уведомление отправится через 'end'

        const data = activeBots[chatId];
        if (data) {
            // Если ошибка связана с прокси/сетью (ECONNRESET, ETIMEDOUT, socketClosed), ставим флаг для ротации
            if (errorMessage.includes('ECONNRESET') || errorMessage.includes('ETIMEDOUT') || errorMessage.includes('socketClosed')) {
                 data.isProxyFailure = true; 
            }
            data.bot.quit('disconnect.error'); 
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

        // 2. Логика ротации прокси
        if (data.isProxyFailure || reason === 'socketClosed') { 
            data.isProxyFailure = false; 
            data.currentProxyIndex++;     
            
            if (data.currentProxyIndex < PROXY_LIST.length) {
                const nextProxyIndex = data.currentProxyIndex;
                sendNotification(chatId, `⚠️ Прокси не сработал. Попытка переподключения с ПРОКСИ №${nextProxyIndex + 1}/${PROXY_LIST.length}.`);

                setTimeout(() => {
                    console.log(`[Chat ${chatId}] Попытка переподключения с новым прокси...`);
                    // Рекурсивный вызов, который возьмет новый индекс прокси
                    setupMineflayerBot(chatId, data.host, data.port, data.username); 
                }, 5000);
                return; 
            } else {
                sendNotification(chatId, `🛑 Бот отключен окончательно. Все ${PROXY_LIST.length} прокси были испробованы.`);
                return cleanupBot(chatId);
            }
        }
        
        // 3. Стандартный реконнект 
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


// --- API ЭНДПОИНТЫ (Модифицированы для async) ---

// /api/start
app.post('/api/start', async (req, res) => {
    const { chatId, host, port, username } = req.body;
    
    if (!chatId || !host || !port || !username) {
        return res.status(400).send({ error: "Missing required parameters: chatId, host, port, or username." });
    }
    
    try {
        if (activeBots[chatId]) {
            activeBots[chatId].reconnectAttempts = 0;
            activeBots[chatId].currentProxyIndex = 0; 
        }
        // Запускаем асинхронную функцию
        await setupMineflayerBot(chatId, host, port, username);
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
        cleanupBot(chatId); 
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
    // Прокси будут загружены при первом вызове /api/start
});
