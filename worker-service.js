const express = require('express');
const mineflayer = require('mineflayer');
const fetch = require('node-fetch'); 

const app = express();
const PORT = process.env.PORT || 8081;

// --- Переменные окружения ---
const WORKER_TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN; // Токен, который будет использоваться для отправки уведомлений
const maxReconnectAttempts = 100;
const reconnectInterval = 300000; // 5 минут

// --- Глобальное состояние ---
const activeBots = {}; 

// --- Middleware ---
app.use(express.json());

// ----------------------------------------------------------------------
//                        ФУНКЦИИ УВЕДОМЛЕНИЙ (НАПРЯМУЮ В TELEGRAM)
// ----------------------------------------------------------------------

/**
 * Отправляет уведомление напрямую в Telegram API.
 */
async function sendTelegramNotification(chatId, message, status) {
    if (!WORKER_TELEGRAM_TOKEN) {
        console.error(`[Chat ${chatId}] TELEGRAM_TOKEN не задан. Уведомления отключены.`);
        return;
    }
    
    // Убираем поле "notifyUrl", отправляем прямо через API
    const telegramApiUrl = `https://api.telegram.org/bot${WORKER_TELEGRAM_TOKEN}/sendMessage`;

    try {
        const response = await fetch(telegramApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                chat_id: chatId, 
                text: message,
                parse_mode: 'Markdown' // Используем Markdown для форматирования
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[Chat ${chatId}] Ошибка отправки уведомления (${response.status}): ${errorText}`);
        }
    } catch (error) {
        console.error(`[Chat ${chatId}] Критическая ошибка сети при отправке уведомления: ${error.message}`);
    }
}

// ----------------------------------------------------------------------
//                        ФУНКЦИИ MINEFLAYER
// ----------------------------------------------------------------------

/**
 * Выполняет случайное анти-AFK действие.
 */
function performRandomAction(mcBot) {
    if (!mcBot || mcBot.end) return;
    
    const actions = ['jump', 'move', 'rotate'];
    const action = actions[Math.floor(Math.random() * actions.length)];

    if (action === 'jump') {
        mcBot.setControlState('jump', true);
        setTimeout(() => mcBot.setControlState('jump', false), 500);
    } else if (action === 'move') {
        const directions = ['forward', 'back', 'left', 'right'];
        const direction = directions[Math.floor(Math.random() * directions.length)];
        mcBot.setControlState(direction, true);
        setTimeout(() => mcBot.setControlState(direction, false), 1000);
    } else if (action === 'rotate') {
        const yaw = Math.random() * Math.PI * 2;
        const pitch = (Math.random() - 0.5) * Math.PI;
        mcBot.look(yaw, pitch, true);
    }
}


/**
 * Останавливает и очищает ресурсы для конкретного бота.
 */
function cleanupBot(chatId) {
    const data = activeBots[chatId];
    if (!data) return;

    if (data.afkIntervalId) {
        clearInterval(data.afkIntervalId);
        data.afkIntervalId = null;
    }
    
    if (data.mcBot) {
        if (typeof data.mcBot.quit === 'function' && !data.mcBot.end) { 
            data.mcBot.quit();
        }
        data.mcBot = null;
    }
    
    delete activeBots[chatId];
    console.log(`[Chat ${chatId}] Ресурсы бота очищены.`);
}

/**
 * Создает и запускает Mineflayer-бота с логикой переподключения и AFK.
 */
function createMinecraftBot(options) {
    const { chatId, host, port, username } = options; // notifyUrl больше не нужен
    const chatKey = String(chatId);
    
    if (activeBots[chatKey] && activeBots[chatKey].reconnectAttempts >= maxReconnectAttempts) {
        sendTelegramNotification(chatId, 'Превышено количество попыток подключения к Minecraft-серверу. Бот остановлен.', 'DISCONNECTED');
        cleanupBot(chatId);
        return;
    }

    if (activeBots[chatKey] && activeBots[chatKey].mcBot) {
        cleanupBot(chatId);
    }
    
    const data = activeBots[chatKey] || { reconnectAttempts: 0 };
    activeBots[chatKey] = data;

    const botOptions = {
        host: host,
        port: port,
        username: username, 
        version: false 
    };

    try {
        const mcBot = mineflayer.createBot(botOptions);
        data.mcBot = mcBot;
        
        // --- Обработчики событий ---
        
        mcBot.on('login', () => {
            sendTelegramNotification(chatId, `✅ Бот **${username}** подключился к ${host}:${port}`, 'CONNECTED');
            data.reconnectAttempts = 0;

            if (!data.afkIntervalId) {
                data.afkIntervalId = setInterval(() => {
                    performRandomAction(mcBot);
                }, 60000); // Анти-AFK каждые 60 секунд
            }
            
            // Логика регистрации для Aternos
            setTimeout(() => {
                 if (mcBot && !mcBot.end) {
                    mcBot.chat('/register 1R2r3 1R2r3'); 
                 }
            }, 5000);
        });

        mcBot.on('end', (reason) => {
            const message = `❌ Бот был отключен (**${reason}**). Попытка переподключения через ${reconnectInterval/1000} секунд.`;
            sendTelegramNotification(chatId, message, 'DISCONNECTED');
            
            data.reconnectAttempts++;
            if (data.afkIntervalId) {
                clearInterval(data.afkIntervalId);
                data.afkIntervalId = null;
            }

            if (data.reconnectAttempts < maxReconnectAttempts) {
                // ПЕРЕЗАПУСК
                setTimeout(() => createMinecraftBot(options), reconnectInterval);
            } else {
                sendTelegramNotification(chatId, '❗️ Достигнуто максимальное количество попыток подключения. Бот остановлен.', 'DISCONNECTED');
                cleanupBot(chatId);
            }
        });

        mcBot.on('error', (err) => {
            const message = `⚠️ Критическая ошибка: ${err.message}. Бот перезапускается.`;
            sendTelegramNotification(chatId, message, 'ERROR');
            
            if (data.mcBot && typeof data.mcBot.quit === 'function' && !data.mcBot.end) {
               data.mcBot.quit(); 
            }
        });
        
        mcBot.on('death', () => {
            sendTelegramNotification(chatId, '💀 Бот умер. Респавн...', 'CONNECTED');
            setTimeout(() => {
              if (mcBot && !mcBot.end) {
                mcBot.respawn();
              }
            }, 5000);
        });

    } catch (err) {
        const message = `❌ Не удалось создать Mineflayer бота. Ошибка: ${err.message}`;
        sendTelegramNotification(chatId, message, 'ERROR');
        data.reconnectAttempts++;
        
        if (data.reconnectAttempts < maxReconnectAttempts) {
            setTimeout(() => createMinecraftBot(options), reconnectInterval);
        } else {
            cleanupBot(chatId);
        }
    }
}

// ----------------------------------------------------------------------
//                             API МАРШРУТЫ
// ----------------------------------------------------------------------

app.post('/api/start', (req, res) => {
    // ВАЖНО: notifyUrl здесь больше не нужен, мы его не запрашиваем
    const { chatId, host, port, username } = req.body; 
    
    if (!chatId || !host || !port || !username) {
        return res.status(400).send({ error: 'Не хватает обязательных параметров: chatId, host, port, username.' });
    }
    
    const chatKey = String(chatId);

    if (activeBots[chatKey]) {
        return res.status(200).send({ status: 'ok', message: 'Бот уже запущен.' });
    }

    const options = { chatId, host, port: Number(port), username };
    
    createMinecraftBot(options);
    console.log(`[Chat ${chatId}] Получена команда START для ${host}:${port}`);
    
    res.status(200).send({ status: 'ok', message: 'Попытка запуска Mineflayer-бота.' });
});


app.post('/api/stop', (req, res) => {
    const { chatId } = req.body;
    
    if (!chatId) {
        return res.status(400).send({ error: 'Не хватает обязательного параметра: chatId.' });
    }
    
    const chatKey = String(chatId);
    
    if (!activeBots[chatKey]) {
        return res.status(200).send({ status: 'ok', message: 'Бот не был запущен.' });
    }

    cleanupBot(chatKey);
    sendTelegramNotification(chatId, '⏹ Minecraft бот безопасно остановлен и отключен от сервера.', 'DISCONNECTED');

    res.status(200).send({ status: 'ok', message: 'Бот остановлен.' });
});

// ----------------------------------------------------------------------
//                             ЗАПУСК СЕРВЕРА
// ----------------------------------------------------------------------

app.listen(PORT, () => {
    console.log(`Mineflayer Worker запущен на порту ${PORT}`);
});
