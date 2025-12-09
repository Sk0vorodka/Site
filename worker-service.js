const express = require('express');
const bodyParser = require('body-parser');
const mineflayer = require('mineflayer');
// УДАЛЕНО: const modSupport = require('mineflayer-modding-support'); 
const net = require("net"); 

const app = express();
const PORT = process.env.PORT || 10000;

// ======================================================================
// --- КОНФИГУРАЦИЯ БОТА И API ---
const TELEGRAM_TOKEN = '8596622001:AAE7NxgyUEQ-mZqTMolt7Kgs2ouM0QyjdIE'; 
const BASE_TELEGRAM_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
// ======================================================================


// ----------------------------------------------------------------------
// --- КОНФИГУРАЦИЯ ПРОКСИ-СПИСКА (Ваш список) ---
const PROXY_LIST = [
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

app.use(bodyParser.json()); 

app.get('/', (req, res) => {
    res.send(`Worker API is running. Loaded ${PROXY_LIST.length} proxies.`);
});

// --- PING UTILITY (Оставлен для автоопределения версии) ---

function makeBuf(server, port) {
    const hostBuffer = Buffer.from(server, 'utf8');
    const bufSize = 7 + hostBuffer.length;
    const buffer = Buffer.alloc(bufSize); 
    buffer.writeUInt8(bufSize - 1, 0);
    buffer.writeUInt8(0, 1);
    buffer.writeUInt8(5, 2); 
    buffer.writeUInt8(hostBuffer.length, 3);
    hostBuffer.copy(buffer, 4);
    buffer.writeUInt16BE(parseInt(port), hostBuffer.length + 4);
    buffer.writeUInt8(1, hostBuffer.length + 6);
    return buffer;
}

const ping = function (server, port, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const MC_DEFAULT_PORT = 25565;
        if (typeof port !== "number") {
            port = MC_DEFAULT_PORT;
        }

        let response = "";
        let receivedHeader = false;
        
        const socket = net.connect({ port: port, host: server }, () => {
            try {
                socket.write(makeBuf(server, port));
                socket.write(Buffer.from("0100", "hex"));
            } catch (e) {
                socket.end();
                return reject(new Error(`Ping error during write: ${e.message}`));
            }
        });

        socket.setTimeout(timeout, () => {
            socket.end();
            reject(new Error(`Socket timed out when connecting to ${server}:${port}`));
        });
        
        socket.on("data", function (data) {
            if (!receivedHeader) {
                response += data.toString('utf8', 5);
                receivedHeader = true;
            } else {
                response += data.toString('utf8');
            }

            try {
                const startIndex = response.indexOf('{');
                if (startIndex !== -1) {
                    const jsonString = response.substring(startIndex);
                    JSON.parse(jsonString);
                    socket.end();
                    resolve(jsonString);
                }
            } catch (e) {
                // Ждем еще данных
            }
        });

        socket.once('error', (e) => {
            socket.end();
            reject(e);
        });
        
        socket.on('end', () => {
            if (!response.includes('{')) {
                 reject(new Error("Connection ended abruptly or received malformed status response."));
            }
        });
    });
};

app.post('/api/ping', async (req, res) => {
    const { host, port } = req.body;
    
    if (!host || !port) {
        return res.status(400).send({ error: "Missing required parameters: host or port." });
    }
    
    try {
        const jsonString = await ping(host, parseInt(port));
        const data = JSON.parse(jsonString);
        
        const version = data.version ? data.version.name : null;
        const description = data.description ? (typeof data.description === 'string' ? data.description : data.description.text) : 'No description';

        const result = {
            online: true,
            version: version,
            description: description
        };

        res.status(200).send(result);

    } catch (e) {
        res.status(200).send({ 
            online: false, 
            error: `Failed to ping server: ${e.message}`,
            message: e.message
        });
    }
});


// --- ФУНКЦИИ УВЕДОМЛЕНИЙ и MINEFLAYER ---

async function sendNotification(chatId, message, isSystemNotification = false) {
    const data = activeBots[chatId];
    
    if (data && isSystemNotification && !data.sendNotifications) {
        return; 
    }
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
            const plainPayload = { chat_id: chatId, text: `[RAW] ${message}` };
            await fetch(url, {
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
        if (activeBots[chatId].afkInterval) {
            clearInterval(activeBots[chatId].afkInterval);
        }
        delete activeBots[chatId];
    }
}


// --- ОСНОВНАЯ ЛОГИКА MINEFLAYER (Упрощенная) ---
async function setupMineflayerBot(chatId, host, port, username, version) {
    const maxAttempts = 5; 

    let data = activeBots[chatId];
    if (data && data.bot) {
        data.bot.quit('disconnect.cleanup'); 
        data.bot = null; 
    }

    if (!data) {
        data = { 
            bot: null, host, port, username, reconnectAttempts: 0, 
            currentProxyIndex: 0, isProxyFailure: false, isStopping: false, 
            afkInterval: null, sendNotifications: true, 
            version: version
        };
        activeBots[chatId] = data;
    } else {
        data.host = host;
        data.port = port;
        data.username = username;
        data.bot = null;
        data.isStopping = false; 
        if (data.afkInterval) clearInterval(data.afkInterval); 
        data.afkInterval = null;
        data.version = version;    
    }

    const currentIndex = data.currentProxyIndex;
    if (currentIndex >= PROXY_LIST.length) {
        sendNotification(chatId, `🛑 Бот отключен окончательно\\. Все ${PROXY_LIST.length} прокси были испробованы\\.`, true); 
        cleanupBot(chatId);
        return;
    }

    const currentProxy = PROXY_LIST[currentIndex];
    
    // БЕЗ ЛОГИКИ МОДОВ
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
    
    // --- ОБРАБОТЧИКИ СОБЫТИЙ MINEFLAYER ---
    // (Логика end, error, login, spawn остается прежней, включая Anti-AFK и ротацию прокси)
    
    bot.on('login', () => {
        sendNotification(chatId, `✅ Бот ${username} успешно подключился к ${host}:${port}`, true); 
        if (activeBots[chatId]) {
            activeBots[chatId].reconnectAttempts = 0; 
            activeBots[chatId].currentProxyIndex = 0; 
        }
    });

    bot.on('error', (err) => {
        const errorMessage = err.message || 'Неизвестная ошибка подключения';
        const data = activeBots[chatId];
        if (data) {
            if (errorMessage.includes('ECONNRESET') || errorMessage.includes('ETIMEDOUT') || errorMessage.includes('socketClosed') || errorMessage.includes('Failed to connect') || errorMessage.includes('EACCES')) {
                 data.isProxyFailure = true; 
            }
            data.bot.quit('disconnect.error'); 
        }
    });

    bot.on('end', (reason) => {
        const data = activeBots[chatId];
        if (!data) return; 
        
        if (data.afkInterval) {
            clearInterval(data.afkInterval);
            data.afkInterval = null;
        }

        if (data.isStopping || reason === 'disconnect.cleanup' || reason === 'disconnect.quitting') {
            return cleanupBot(chatId);
        }

        let notificationMessage;
        
        const isNetworkOrProxyFailure = data.isProxyFailure || reason === 'socketClosed' || reason === 'disconnect.error';
        
        if (isNetworkOrProxyFailure) {
            data.isProxyFailure = false; 
            data.currentProxyIndex++;     
            
            if (data.currentProxyIndex < PROXY_LIST.length) {
                const nextProxyIndex = data.currentProxyIndex;
                notificationMessage = `⚠️ Прокси не сработал\\. Попытка переподключения с ПРОКСИ №${nextProxyIndex + 1}/${PROXY_LIST.length}\\.`;
                sendNotification(chatId, notificationMessage, true); 
                setTimeout(() => {
                    setupMineflayerBot(chatId, data.host, data.port, data.username, data.version); 
                }, 5000);
                return; 
            } else {
                notificationMessage = `🛑 Бот отключен окончательно\\. Все ${PROXY_LIST.length} прокси были испробованы\\.`;
                sendNotification(chatId, notificationMessage, true); 
                return cleanupBot(chatId);
            }
        } 
        
        data.reconnectAttempts++;

        if (data.reconnectAttempts < maxAttempts) {
            notificationMessage = `⚠️ Бот был отключен \\(Причина: ${reason}\\)\\. Попытка переподключения \\(${data.reconnectAttempts}/${maxAttempts}\\)\\.\\.\\.`;
            sendNotification(chatId, notificationMessage, true); 
            
            setTimeout(() => {
                setupMineflayerBot(chatId, data.host, data.port, data.username, data.version); 
            }, 5000 * data.reconnectAttempts); 
        } else {
            notificationMessage = `🛑 Бот отключен окончательно \\(Причина: ${reason}\\)\\. Достигнут лимит попыток переподключения\\.`;
            sendNotification(chatId, notificationMessage, true); 
            cleanupBot(chatId);
        }
    });
    
    bot.on('spawn', () => {
        sendNotification(chatId, `🌍 Бот заспавнился и готов к работе\\.`, true); 
        
        const AFK_INTERVAL = 1200000; 
        
        if (data.afkInterval) clearInterval(data.afkInterval); 
        
        data.afkInterval = setInterval(() => {
            if (data.bot && data.bot.entity) {
                data.bot.setControlState('jump', true);
                data.bot.setControlState('jump', false);
            } else {
                if (data.afkInterval) clearInterval(data.afkInterval);
                data.afkInterval = null;
            }
        }, AFK_INTERVAL);
    });
}

// --- API ЭНДПОИНТЫ (Упрощенные) ---

app.post('/api/start', async (req, res) => {
    // УДАЛЕНО: isModded
    const { chatId, host, port, username, sendNotifications, version } = req.body; 
    
    if (!chatId || !host || !port || !username || !version) {
        return res.status(400).send({ error: "Missing required parameters: chatId, host, port, username, or version." });
    }
    
    try {
        if (!activeBots[chatId]) {
             activeBots[chatId] = {}; 
        }
        
        activeBots[chatId].sendNotifications = sendNotifications !== undefined ? sendNotifications : true; 
        activeBots[chatId].reconnectAttempts = 0;
        activeBots[chatId].currentProxyIndex = 0; 
        activeBots[chatId].isStopping = false; 

        // УДАЛЕНО: isModded
        await setupMineflayerBot(chatId, host, port, username, version);
        res.status(200).send({ message: "Bot start command received." });
    } catch (e) {
        res.status(500).send({ error: e.message });
    }
});

// ... (Остальные эндпоинты stop, command, status остаются без изменений) ...

app.listen(PORT, () => {
    console.log(`Worker service running on port ${PORT}`);
});
