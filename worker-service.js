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
// --- ⚠️ ФИНАЛЬНАЯ КОНФИГУРАЦИЯ ПРОКСИ-СПИСКА (Ваш новый адрес) ---
// В режиме теста мы используем только один адрес.
const PROXY_LIST_URL = null; // Отключено
let PROXY_LIST = [{ host: '67.210.146.50', port: 11080 }]; 
// --- КОНЕЦ КОНФИГУРАЦИИ ПРОКСИ ---
// ----------------------------------------------------------------------

const activeBots = {}; 

// --- ФУНКЦИИ УВЕДОМЛЕНИЙ (С подавлением спама) ---
async function sendNotification(chatId, message) {
    // Безопасная проверка: если бот помечен как останавливаемый, не отправляем уведомления!
    const data = activeBots[chatId];
    if (data && data.isStopping) {
        return; 
    }

    try {
        const { default: fetch } = await import('node-fetch'); 

        if (!TELEGRAM_TOKEN) return console.error(`[Chat ${chatId}] Ошибка: TELEGRAM_TOKEN не установлен.`);
        
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
        
        if (!response.ok && response.status === 400) {
            console.warn(`[Chat ${chatId}] Ошибка MarkdownV2, отправляю обычный текст.`);
            const plainPayload = { chat_id: chatId, text: `[RAW] ${message}` };
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


// --- КОНФИГУРАЦИЯ EXPRESS ---
app.use(bodyParser.json()); 
app.get('/', (req, res) => {
    res.send(`Worker API is running. Currently loaded ${PROXY_LIST.length} proxies.`);
});


// --- ФУНКЦИИ ПАРСИНГА И ЗАГРУЗКИ ПРОКСИ ---
async function fetchAndParseProxyList() {
    // В этом коде эта функция будет проигнорирована, так как PROXY_LIST уже содержит адрес.
    if (!PROXY_LIST_URL) return PROXY_LIST; 
    
    try {
        const { default: fetch } = await import('node-fetch'); 
        console.log('[Proxy Manager] Загрузка списка прокси с внешнего URL (JSON)...');
        // ... (логика загрузки)
        const response = await fetch(PROXY_LIST_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                'Referer': 'https://www.google.com/', 
            },
            redirect: 'follow'
        });
        
        if (!response.ok) throw new Error(`Ошибка HTTP: ${response.status} ${response.statusText}`);
        
        const jsonList = await response.json();
        if (!Array.isArray(jsonList)) throw new Error("Ответ API не является массивом.");
        
        const parsedList = jsonList
            .filter(item => item.ip && item.port)
            .map(item => ({ host: item.ip.trim(), port: parseInt(item.port) }))
            .filter(proxy => !isNaN(proxy.port));
        
        console.log(`[Proxy Manager] Успешно загружено и обработано ${parsedList.length} прокси.`);
        return parsedList;
    } catch (e) {
        console.error(`[Proxy Manager] ОШИБКА при загрузке прокси-листа: ${e.message}`);
        return [];
    }
}


// --- ОСНОВНАЯ ЛОГИКА MINEFLAYER ---

async function setupMineflayerBot(chatId, host, port, username) {
    const maxAttempts = 5; 

    // 0. Асинхронная загрузка списка прокси при первой необходимости
    if (PROXY_LIST.length === 0) {
        PROXY_LIST = await fetchAndParseProxyList();
        
        if (PROXY_LIST.length === 0) {
            console.log(`[Chat ${chatId}] Нет доступных прокси. Отключение.`);
            sendNotification(chatId, `🛑 Не удалось загрузить прокси-лист\\.`, 'MarkdownV2');
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
        data = { bot: null, host, port, username, reconnectAttempts: 0, currentProxyIndex: 0, isProxyFailure: false, isStopping: false };
        activeBots[chatId] = data;
    } else {
        data.host = host;
        data.port = port;
        data.username = username;
        data.bot = null;
        data.isStopping = false; 
    }


    // 2. Проверка ротации (даже если 1 прокси)
    const currentIndex = data.currentProxyIndex;
    
    if (currentIndex >= PROXY_LIST.length) {
        console.log(`[Chat ${chatId}] Все ${PROXY_LIST.length} прокси были испробованы. Отключение.`);
        sendNotification(chatId, `🛑 Бот отключен окончательно\\. Все ${PROXY_LIST.length} прокси были испробованы\\.`, 'MarkdownV2');
        cleanupBot(chatId);
        return;
    }

    const currentProxy = PROXY_LIST[currentIndex];
    
    console.log(`[Chat ${chatId}] Запуск Mineflayer с: Host=${host}, Port=${port}, Username=${username} | ПРОКСИ: ${currentProxy.host}:${currentProxy.port} (№${currentIndex + 1}/${PROXY_LIST.length})`);

    const bot = mineflayer.createBot({
        host: host, 
        port: parseInt(port), 
        username: username,
        version: '1.20.1', 
        
        proxy: {
            host: currentProxy.host,
            port: currentProxy.port,
            type: 5 
        }
    });

    data.bot = bot; 
    
    // --- ОБРАБОТЧИКИ СОБЫТИЙ MINEFLAYER ---

    bot.on('login', () => {
        console.log(`[Chat ${chatId}] Бот ${username} подключился к ${host}:${port}`);
        sendNotification(chatId, `✅ Бот ${username} успешно подключился к ${host}:${port}`, 'MarkdownV2');
        
        if (activeBots[chatId]) {
            activeBots[chatId].reconnectAttempts = 0; 
            activeBots[chatId].currentProxyIndex = 0; 
        }
    });

    bot.on('error', (err) => {
        const errorMessage = err.message || 'Неизвестная ошибка подключения';
        console.error(`[Chat ${chatId}] Ошибка бота: ${errorMessage}`);

        const data = activeBots[chatId];
        if (data) {
            if (errorMessage.includes('ECONNRESET') || errorMessage.includes('ETIMEDOUT') || errorMessage.includes('socketClosed') || errorMessage.includes('Failed to connect')) {
                 data.isProxyFailure = true; 
            }
            data.bot.quit('disconnect.error'); 
        }
    });

    bot.on('end', (reason) => {
        console.log(`[Chat ${chatId}] Бот отключен. Причина: ${reason}`);
        
        const data = activeBots[chatId];
        if (!data) return; 
        
        // 1. ФИНАЛЬНАЯ ПРОВЕРКА ФЛАГА ОСТАНОВКИ
        if (data.isStopping) {
            console.log(`[Chat ${chatId}] Остановка по команде пользователя. Подавление уведомлений.`);
            return cleanupBot(chatId);
        }
        
        // 2. Специальные причины для немедленного выхода
        if (reason === 'disconnect.cleanup') {
            return cleanupBot(chatId);
        }

        // 3. Логика ротации прокси
        if (data.isProxyFailure || reason === 'socketClosed') { 
            data.isProxyFailure = false; 
            data.currentProxyIndex++;     
            
            if (data.currentProxyIndex < PROXY_LIST.length) {
                const nextProxyIndex = data.currentProxyIndex;
                sendNotification(chatId, `⚠️ Прокси не сработал\\. Попытка переподключения с ПРОКСИ №${nextProxyIndex + 1}/${PROXY_LIST.length}\\.`, 'MarkdownV2');

                setTimeout(() => {
                    console.log(`[Chat ${chatId}] Попытка переподключения с новым прокси...`);
                    setupMineflayerBot(chatId, data.host, data.port, data.username); 
                }, 5000);
                return; 
            } else {
                sendNotification(chatId, `🛑 Бот отключен окончательно\\. Все ${PROXY_LIST.length} прокси были испробованы\\.`, 'MarkdownV2');
                return cleanupBot(chatId);
            }
        }
        
        // 4. Стандартный реконнект 
        data.reconnectAttempts++;

        if (data.reconnectAttempts < maxAttempts) {
            sendNotification(chatId, `⚠️ Бот был отключен \\(${reason}\\)\\. Попытка переподключения \\(${data.reconnectAttempts}/${maxAttempts}\\)\\.\\.\\.`, 'MarkdownV2');
            
            setTimeout(() => {
                console.log(`[Chat ${chatId}] Попытка переподключения...`);
                setupMineflayerBot(chatId, data.host, data.port, data.username); 
            }, 5000 * data.reconnectAttempts); 
        } else {
            sendNotification(chatId, `🛑 Бот отключен окончательно \\(${reason}\\)\\. Достигнут лимит попыток переподключения\\.`, 'MarkdownV2');
            cleanupBot(chatId);
        }
    });
    
    bot.on('spawn', () => {
        console.log(`[Chat ${chatId}] Бот заспавнился. Готов к работе.`);
        sendNotification(chatId, `🌍 Бот заспавнился и готов к работе\\.`, 'MarkdownV2');
    });
}


// --- API ЭНДПОИНТЫ ---

app.post('/api/start', async (req, res) => {
    const { chatId, host, port, username } = req.body;
    
    if (!chatId || !host || !port || !username) {
        return res.status(400).send({ error: "Missing required parameters: chatId, host, port, or username." });
    }
    
    try {
        if (activeBots[chatId]) {
            activeBots[chatId].reconnectAttempts = 0;
            activeBots[chatId].currentProxyIndex = 0; 
            activeBots[chatId].isStopping = false; 
        }
        await setupMineflayerBot(chatId, host, port, username);
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
