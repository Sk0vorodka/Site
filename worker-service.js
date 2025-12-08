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
// --- КОНФИГУРАЦИЯ ПРОКСИ-СПИСКА (Ваш обновленный список) ---
const PROXY_LIST_URL = null; 
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

// --- ФУНКЦИИ УВЕДОМЛЕНИЙ (С учетом флага sendNotifications) ---
async function sendNotification(chatId, message, isSystemReconnect = false) {
    const data = activeBots[chatId];
    // Подавляем системные сообщения о реконнекте, если уведомления отключены
    if (data && (data.isStopping || (isSystemReconnect && !data.sendNotifications))) {
        if (data.isStopping) console.log(`[Chat ${chatId}] Уведомление подавлено (остановка).`);
        if (isSystemReconnect && !data.sendNotifications) console.log(`[Chat ${chatId}] Уведомление подавлено (отключено пользователем).`);
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
    } catch (e) {
        console.error(`[Chat ${chatId}] Критическая ошибка сети при отправке уведомления: ${e.message}`);
    }
}

function cleanupBot(chatId) {
    if (activeBots[chatId]) {
        console.log(`[Chat ${chatId}] Ресурсы бота очищены.`);
        // Очищаем Anti-AFK интервал
        if (activeBots[chatId].afkInterval) {
            clearInterval(activeBots[chatId].afkInterval);
        }
        delete activeBots[chatId];
    }
}


// --- ОСНОВНАЯ ЛОГИКА MINEFLAYER ---

async function setupMineflayerBot(chatId, host, port, username) {
    const maxAttempts = 5; 

    // 1. Инициализация/Обновление состояния
    let data = activeBots[chatId];
    if (data && data.bot) {
        console.log(`[Chat ${chatId}] Обнаружен старый бот. Отключаю: ${data.host}:${data.port}`);
        data.bot.quit('disconnect.cleanup'); 
        data.bot = null; 
    }

    if (!data) {
        // Устанавливаем isStopping=false и добавляем afkInterval, sendNotifications
        data = { 
            bot: null, host, port, username, reconnectAttempts: 0, 
            currentProxyIndex: 0, isProxyFailure: false, isStopping: false, 
            afkInterval: null, sendNotifications: true // Значение будет обновлено из API
        };
        activeBots[chatId] = data;
    } else {
        data.host = host;
        data.port = port;
        data.username = username;
        data.bot = null;
        data.isStopping = false; 
        if (data.afkInterval) clearInterval(data.afkInterval); // Очищаем старый интервал
        data.afkInterval = null;
    }


    // 2. Проверка ротации прокси
    const currentIndex = data.currentProxyIndex;
    if (currentIndex >= PROXY_LIST.length) {
        console.log(`[Chat ${chatId}] Все ${PROXY_LIST.length} прокси были испробованы. Отключение.`);
        sendNotification(chatId, `🛑 Бот отключен окончательно\\. Все ${PROXY_LIST.length} прокси были испробованы\\.`, false);
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
        sendNotification(chatId, `✅ Бот ${username} успешно подключился к ${host}:${port}`, false);
        
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
            // Эти ошибки указывают на проблемы с прокси/сетью
            if (errorMessage.includes('ECONNRESET') || errorMessage.includes('ETIMEDOUT') || errorMessage.includes('socketClosed') || errorMessage.includes('Failed to connect') || errorMessage.includes('EACCES')) {
                 data.isProxyFailure = true; 
            }
            data.bot.quit('disconnect.error'); 
        }
    });

    bot.on('end', (reason) => {
        console.log(`[Chat ${chatId}] Бот отключен. Причина: ${reason}`);
        
        const data = activeBots[chatId];
        if (!data) return; 
        
        // Очищаем Anti-AFK интервал
        if (data.afkInterval) {
            clearInterval(data.afkInterval);
            data.afkInterval = null;
        }

        // 1. ПРОВЕРКА ФЛАГА ОСТАНОВКИ И СПЕЦИАЛЬНЫЕ ПРИЧИНЫ
        if (data.isStopping || reason === 'disconnect.cleanup' || reason === 'disconnect.quitting') {
            if (data.isStopping) console.log(`[Chat ${chatId}] Остановка по команде пользователя. Подавление уведомлений.`);
            return cleanupBot(chatId);
        }

        let notificationMessage;
        
        // 2. ИДЕНТИФИКАЦИЯ ТИПА ОТКЛЮЧЕНИЯ
        const isNetworkOrProxyFailure = data.isProxyFailure || reason === 'socketClosed' || reason === 'disconnect.error';
        
        if (isNetworkOrProxyFailure) {
            // ЛОГИКА РОТАЦИИ ПРОКСИ
            data.isProxyFailure = false; 
            data.currentProxyIndex++;     
            
            if (data.currentProxyIndex < PROXY_LIST.length) {
                const nextProxyIndex = data.currentProxyIndex;
                notificationMessage = `⚠️ Прокси не сработал\\. Попытка переподключения с ПРОКСИ №${nextProxyIndex + 1}/${PROXY_LIST.length}\\.`;
                sendNotification(chatId, notificationMessage, true); // Системное уведомление
                setTimeout(() => {
                    console.log(`[Chat ${chatId}] Попытка переподключения с новым прокси...`);
                    setupMineflayerBot(chatId, data.host, data.port, data.username); 
                }, 5000);
                return; 
            } else {
                notificationMessage = `🛑 Бот отключен окончательно\\. Все ${PROXY_LIST.length} прокси были испробованы\\.`;
                sendNotification(chatId, notificationMessage, false); 
                return cleanupBot(chatId);
            }
        } 
        
        // 3. СТАНДАРТНЫЙ РЕКОННЕКТ (для кика/бана/таймаута - используем причину)
        data.reconnectAttempts++;

        if (data.reconnectAttempts < maxAttempts) {
            // Отправляем причину, полученную от сервера, в Telegram
            notificationMessage = `⚠️ Бот был отключен \\(Причина: ${reason}\\)\\. Попытка переподключения \\(${data.reconnectAttempts}/${maxAttempts}\\)\\.\\.\\.`;
            sendNotification(chatId, notificationMessage, true); // Системное уведомление
            
            setTimeout(() => {
                console.log(`[Chat ${chatId}] Попытка переподключения...`);
                setupMineflayerBot(chatId, data.host, data.port, data.username); 
            }, 5000 * data.reconnectAttempts); 
        } else {
            notificationMessage = `🛑 Бот отключен окончательно \\(Причина: ${reason}\\)\\. Достигнут лимит попыток переподключения\\.`;
            sendNotification(chatId, notificationMessage, false);
            cleanupBot(chatId);
        }
    });
    
    bot.on('spawn', () => {
        console.log(`[Chat ${chatId}] Бот заспавнился. Готов к работе.`);
        sendNotification(chatId, `🌍 Бот заспавнился и готов к работе\\.`, false);
        
        // --- ANTI-AFK ЛОГИКА (Пункт 3А) ---
        // 20 минут = 1200000 мс
        const AFK_INTERVAL = 1200000; 
        
        if (data.afkInterval) clearInterval(data.afkInterval); 
        
        data.afkInterval = setInterval(() => {
            if (data.bot && data.bot.entity) {
                // Выполняем простой прыжок
                data.bot.setControlState('jump', true);
                data.bot.setControlState('jump', false);
                console.log(`[Chat ${chatId}] Выполнено действие Anti-AFK (прыжок).`);
            } else {
                // Если бот отключился, очищаем интервал
                if (data.afkInterval) clearInterval(data.afkInterval);
                data.afkInterval = null;
            }
        }, AFK_INTERVAL);
        // --- КОНЕЦ ANTI-AFK ЛОГИКИ ---
    });
}


// --- API ЭНДПОИНТЫ ---

app.post('/api/start', async (req, res) => {
    // 💡 ИЗМЕНЕНИЕ: Получаем новые параметры version и isModded
    const { chatId, host, port, username, sendNotifications, version, isModded } = req.body; 
    
    if (!chatId || !host || !port || !username || !version) {
        return res.status(400).send({ error: "Missing required parameters: chatId, host, port, username, or version." });
    }
    
    try {
        if (!activeBots[chatId]) {
             activeBots[chatId] = {}; 
        }
        
        // Сохраняем или обновляем статус уведомлений
        activeBots[chatId].sendNotifications = sendNotifications !== undefined ? sendNotifications : true; 

        activeBots[chatId].reconnectAttempts = 0;
        activeBots[chatId].currentProxyIndex = 0; 
        activeBots[chatId].isStopping = false; 

        // 💡 ИЗМЕНЕНИЕ: Передаем версию и статус модов в Mineflayer
        await setupMineflayerBot(chatId, host, port, username, version, isModded);
        res.status(200).send({ message: "Bot start command received." });
    } catch (e) {
        res.status(500).send({ error: e.message });
    }
});

// ИЗМЕНЕНИЕ: Обновляем сигнатуру setupMineflayerBot
async function setupMineflayerBot(chatId, host, port, username, version, isModded) {
    // ... ваш код инициализации ...

    // ... в начале функции, где инициализируется data ...
    if (!data) {
        data = { 
            bot: null, host, port, username, reconnectAttempts: 0, 
            currentProxyIndex: 0, isProxyFailure: false, isStopping: false, 
            afkInterval: null, sendNotifications: true, 
            version: version, // <-- ДОБАВЛЕНО
            isModded: isModded // <-- ДОБАВЛЕНО
        };
        activeBots[chatId] = data;
    } else {
        // ...
        data.version = version; // <-- ДОБАВЛЕНО
        data.isModded = isModded; // <-- ДОБАВЛЕНО
        // ...
    }

    // ...
    
    // ИЗМЕНЕНИЕ: Меняем Mineflayer.createBot()
    const bot = mineflayer.createBot({
        host: host, 
        port: parseInt(port), 
        username: username,
        version: version, // <--- ИСПОЛЬЗУЕМ ВЕРСИЮ ИЗ TG
        
        // 💡 УСЛОВИЕ ДЛЯ МОДОВ
        // Если вы используете плагин, он должен быть инициализирован здесь
        // Пример (НЕ ИСПОЛЬЗУЕТСЯ, но для справки):
        // (isModded && version.startsWith('1.12')) ? '1.12.2-forge' : version
        
        proxy: {
            host: currentProxy.host,
            port: currentProxy.port,
            type: 5 
        }
    });
    
    // 💡 Инициализация плагина для модов, если isModded == true
    // ЭТО ТРЕБУЕТ УСТАНОВКИ ДОПОЛНИТЕЛЬНОГО ПЛАГИНА (например, mineflayer-forge)
    // Если вы установите плагин, добавьте здесь:
    /*
    if (isModded) {
        const forge = require('mineflayer-forge');
        bot.loadPlugin(forge);
    }
    */
    
    data.bot = bot; 
    // ... остальной код ...
}
});

// ... остальные API-эндпоинты (/api/stop, /api/command) остаются без изменений ...

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
