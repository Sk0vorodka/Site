const express = require('express');
const bodyParser = require('body-parser'); 
const mineflayer = require('mineflayer');

const app = express();
const PORT = process.env.PORT || 10000;

// ======================================================================
// --- КОНФИГУРАЦИЯ БОТА И API ---
const TELEGRAM_TOKEN = '8596622001:AAE7NxgyUEQ-mZqTMolt7Kgs2ouM0QyjdIE'; 
const BASE_TELEGRAM_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
// ======================================================================


// ----------------------------------------------------------------------
// --- КОНФИГУРАЦИЯ ПРОКСИ ---
const PROXY_LIST_URL = null; // Отключено
let PROXY_LIST = [
    { host: '203.25.208.163', port: 1100 },
    { host: '13.231.213.224', port: 1080 },
    { host: '47.82.117.31', port: 1100 },
    { host: '203.25.208.163', port: 1111 },
    { host: '46.146.220.180', port: 1080 },
    { host: '109.168.173.173', port: 1080 },
    { host: '78.140.46.48', port: 1080 },
    { host: '47.82.117.31', port: 1011 },
    { host: '89.148.196.156', port: 1080 },
    { host: '37.192.133.82', port: 1080 },
    { host: '121.169.46.116', port: 1090 },
    { host: '192.241.156.17', port: 1080 },
    { host: '38.183.144.18', port: 1080 },
    { host: '143.110.217.153', port: 1080 }
]; 
// ----------------------------------------------------------------------

const activeBots = {}; 

// --- КОНФИГУРАЦИЯ EXPRESS ---
app.use(bodyParser.json()); 

app.get('/', (req, res) => {
    res.send(`Worker API is running. Currently loaded ${PROXY_LIST.length} proxies.`);
});

// --- ФУНКЦИИ УВЕДОМЛЕНИЙ ---
async function sendNotification(chatId, message) {
    const data = activeBots[chatId];
    if (data && data.isStopping) {
        return; 
    }

    try {
        // Динамический импорт node-fetch
        const { default: fetch } = await import('node-fetch'); 
        if (!TELEGRAM_TOKEN) return console.error(`[Chat ${chatId}] Ошибка: TELEGRAM_TOKEN не установлен.`);
        
        // Экранирование для MarkdownV2
        const escapedMessage = message.replace(/[().!]/g, '\\$&');

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
        
        // Попытка отправить как обычный текст, если MarkdownV2 не сработал
        if (!response.ok && response.status === 400) {
            console.warn(`[Chat ${chatId}] Ошибка MarkdownV2, отправляю обычный текст.`);
            const plainPayload = { chat_id: chatId, text: `[RAW] ${message}` };
            response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(plainPayload)
            });
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
async function fetchAndParseProxyList() {
    if (!PROXY_LIST_URL) return PROXY_LIST; 
    return []; 
}

// --- ОСНОВНАЯ ЛОГИКА MINEFLAYER (С ИСПРАВЛЕННОЙ ОБРАБОТКОЙ ОШИБОК) ---
async function setupMineflayerBot(chatId, host, port, username, version) {
    const maxAttempts = 5; 

    if (PROXY_LIST.length === 0) {
        PROXY_LIST = await fetchAndParseProxyList();
        if (PROXY_LIST.length === 0) {
            console.log(`[Chat ${chatId}] Нет доступных прокси. Отключение.`);
            sendNotification(chatId, `🛑 Не удалось найти прокси-лист\\.`, 'MarkdownV2');
            return cleanupBot(chatId);
        }
    }

    let data = activeBots[chatId];
    if (data && data.bot) {
        console.log(`[Chat ${chatId}] Обнаружен старый бот. Отключаю: ${data.host}:${data.port}`);
        data.bot.quit('disconnect.cleanup'); 
        data.bot = null; 
    }

    if (!data) {
        data = { bot: null, host, port, username, version, reconnectAttempts: 0, currentProxyIndex: 0, isProxyFailure: false, isStopping: false };
        activeBots[chatId] = data;
    } else {
        data.host = host;
        data.port = port;
        data.username = username;
        data.version = version; 
        data.bot = null;
        data.isStopping = false; 
    }

    const currentIndex = data.currentProxyIndex;
    
    if (currentIndex >= PROXY_LIST.length) {
        console.log(`[Chat ${chatId}] Все ${PROXY_LIST.length} прокси были испробованы. Отключение.`);
        sendNotification(chatId, `🛑 Бот отключен окончательно\\. Все ${PROXY_LIST.length} прокси были испробованы\\.`, 'MarkdownV2');
        cleanupBot(chatId);
        return;
    }

    const currentProxy = PROXY_LIST[currentIndex];
    
    console.log(`[Chat ${chatId}] Запуск Mineflayer с: Host=${host}, Port=${port}, Username=${username}, Version=${version} | ПРОКСИ: ${currentProxy.host}:${currentProxy.port} (№${currentIndex + 1}/${PROXY_LIST.length})`);

    const bot = mineflayer.createBot({
        host: host, 
        port: parseInt(port), 
        username: username,
        version: version, 
        
        proxy: {
            host: currentProxy.host,
            port: currentProxy.port,
            type: 5 
        }
    });

    data.bot = bot; 
    
    bot.on('login', () => {
        console.log(`[Chat ${chatId}] Бот ${username} подключился к ${host}:${port}`);
        sendNotification(chatId, `✅ Бот ${username} успешно подключился к ${host}:${port}`, 'MarkdownV2');
        
        if (activeBots[chatId]) {
            activeBots[chatId].reconnectAttempts = 0; 
            activeBots[chatId].currentProxyIndex = 0; 
        }
    });

    // --- ОБРАБОТКА ОШИБОК ---
    bot.on('error', (err) => {
        const errorMessage = err.message || 'Неизвестная ошибка подключения';
        console.error(`[Chat ${chatId}] Ошибка бота: ${errorMessage}`);

        const data = activeBots[chatId];
        if (!data) return;

        // --- УСИЛЕННАЯ ПРОВЕРКА ФАТАЛЬНЫХ ОШИБОК (Сервер недоступен) ---
        const fatalErrorKeywords = [
            'ECONNREFUSED',  // Соединение отказано (сервер выключен)
            'EHOSTUNREACH',  // Хост недоступен
            'ENOTFOUND'      // Домен не найден
        ];

        let isFatalError = false;
        for (const keyword of fatalErrorKeywords) {
            if (errorMessage.includes(keyword)) {
                isFatalError = true;
                break;
            }
        }
        
        if (isFatalError) {
             // 1. Отправляем явное уведомление об ошибке
            sendNotification(chatId, `❌ **КРИТИЧЕСКАЯ ОШИБКА ПОДКЛЮЧЕНИЯ.**\nСервер \\*${data.host}:${data.port}\\* недоступен или не существует\\.\nОшибка: \`${errorMessage.substring(0, 100)}\\.\.\`\\.\n\\(Переподключение невозможно\\)`, 'MarkdownV2');
            
            // 2. Явно завершаем и очищаем ресурсы
            data.isStopping = true; // Помечаем как остановку
            data.bot.quit('disconnect.fatal_error'); 
            cleanupBot(chatId);
            return; // Завершаем функцию, чтобы не попасть в end/retry
        }

        // Если ошибка не фатальна, проверяем на ошибку прокси/сокета/таймаут
        if (errorMessage.includes('ECONNRESET') || errorMessage.includes('ETIMEDOUT') || errorMessage.includes('socketClosed') || errorMessage.includes('Failed to connect') || errorMessage.includes('EACCES') || errorMessage.includes('Proxy authentication failed')) {
            data.isProxyFailure = true; 
        }
        data.bot.quit('disconnect.error'); 
    });

    bot.on('end', (reason) => {
        console.log(`[Chat ${chatId}] Бот отключен. Причина: ${reason}`);
        
        const data = activeBots[chatId];
        if (!data) return; 
        
        // Обработка фатальной ошибки, остановки или очистки
        if (data.isStopping || reason === 'disconnect.fatal_error' || reason === 'disconnect.cleanup' || reason === 'disconnect.quitting') {
            return cleanupBot(chatId);
        }
        
        // Обработка сбоя прокси/сокета -> смена прокси
        if (data.isProxyFailure || reason === 'socketClosed') { 
            data.isProxyFailure = false; 
            data.currentProxyIndex++;     
            
            if (data.currentProxyIndex < PROXY_LIST.length) {
                const nextProxyIndex = data.currentProxyIndex;
                sendNotification(chatId, `⚠️ Прокси не сработал\\. Попытка переподключения с ПРОКСИ №${nextProxyIndex + 1}/${PROXY_LIST.length}\\.`, 'MarkdownV2');

                setTimeout(() => {
                    console.log(`[Chat ${chatId}] Попытка переподключения с новым прокси...`);
                    setupMineflayerBot(chatId, data.host, data.port, data.username, data.version); 
                }, 5000);
                return; 
            } else {
                sendNotification(chatId, `🛑 Бот отключен окончательно\\. Все ${PROXY_LIST.length} прокси были испробованы\\.`, 'MarkdownV2');
                return cleanupBot(chatId);
            }
        }
        
        // Стандартная попытка переподключения
        data.reconnectAttempts++;

        if (data.reconnectAttempts < maxAttempts) {
            sendNotification(chatId, `⚠️ Бот был отключен \\(${reason}\\)\\. Попытка переподключения \\(${data.reconnectAttempts}/${maxAttempts}\\)\\.\\.\\.`, 'MarkdownV2');
            
            setTimeout(() => {
                console.log(`[Chat ${chatId}] Попытка переподключения...`);
                setupMineflayerBot(chatId, data.host, data.port, data.username, data.version); 
            }, 5000 * data.reconnectAttempts); 
        } else {
            sendNotification(chatId, `🛑 Бот отключен окончательно \\(${reason}\\)\\. Достигнут лимит попыток переподключения\\.`, 'MarkdownV2');
            cleanupBot(chatId);
        }
    });
    // --- КОНЕЦ ОБРАБОТКИ ОШИБОК ---
    
    bot.on('spawn', () => {
        console.log(`[Chat ${chatId}] Бот заспавнился. Готов к работе.`);
        sendNotification(chatId, `🌍 Бот заспавнился и готов к работе\\.`, 'MarkdownV2');
        // Здесь можно добавить вашу собственную логику Anti-AFK через команды, если нужно
    });
}

// --- API ЭНДПОИНТЫ ---

app.get('/api/status/:chatId', (req, res) => {
    const chatId = req.params.chatId;
    const isRunning = !!activeBots[chatId] && !!activeBots[chatId].bot && !activeBots[chatId].isStopping;
    res.status(200).send({ isRunning: isRunning });
});

app.post('/api/start', async (req, res) => {
    const { chatId, host, port, username, version } = req.body; 
    
    if (!chatId || !host || !port || !username || !version) {
        return res.status(400).send({ error: "Missing required parameters: chatId, host, port, username, or version." });
    }
    
    try {
        if (activeBots[chatId]) {
            activeBots[chatId].reconnectAttempts = 0;
            activeBots[chatId].currentProxyIndex = 0; 
            activeBots[chatId].isStopping = false; 
        }
        await setupMineflayerBot(chatId, host, port, username, version);
        res.status(200).send({ message: "Bot start command received." });
    } catch (e) {
        res.status(500).send({ error: e.message });
    }
});

app.post('/api/stop', (req, res) => {
    const { chatId } = req.body; 
    if (!chatId) {
        return res.status(400).send({ error: "Missing required parameter: chatId." });
    }

    if (activeBots[chatId] && activeBots[chatId].bot) {
        activeBots[chatId].isStopping = true; 
        activeBots[chatId].bot.quit('disconnect.quitting');
        res.status(200).send({ message: "Bot stop command received. Disconnecting." });
    } else {
        res.status(404).send({ message: "Bot not found or not running for this chat." });
        cleanupBot(chatId); 
    }
});

app.post('/api/command', (req, res) => {
    const { chatId, command } = req.body;
    
    if (!chatId || !command) {
        return res.status(400).send({ error: "Missing required parameters: chatId or command." });
    }

    if (activeBots[chatId] && activeBots[chatId].bot) {
        try {
            // Отправляем команду в чат Mineflayer
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

app.listen(PORT, () => {
    console.log(`Worker service running on port ${PORT}`);
});
