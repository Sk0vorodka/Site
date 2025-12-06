const mineflayer = require('mineflayer');
const TelegramBot = require('node-telegram-bot-api');

// --- Переменные окружения для Render ---
const telegramToken = process.env.TELEGRAM_TOKEN;
const chatId = process.env.CHAT_ID;
const port = process.env.PORT || 80; // Порт для Webhook, предоставляемый Render
const url = process.env.RENDER_EXTERNAL_HOSTNAME; // Адрес сервиса Render

if (!telegramToken || !chatId || !url) {
  console.error('ОШИБКА: Не заданы необходимые переменные окружения: TELEGRAM_TOKEN, CHAT_ID, или RENDER_EXTERNAL_HOSTNAME. Убедитесь, что Web Service активен.');
  process.exit(1);
}

// --- Инициализация Telegram бота с Webhooks ---
const bot = new TelegramBot(telegramToken, { 
    polling: false // Отключаем Polling
});

// Установка Webhook: Telegram будет отправлять обновления на этот адрес
bot.setWebHook(`https://${url}/bot${telegramToken}`, { allowed_updates: ["message", "callback_query"] });

// Запуск прослушивания HTTP-запросов от Telegram
bot.openWebHook();

// --- Глобальное состояние бота ---
let isBotStarted = false;
let mcBotInstance = null;
let currentHost = null;
let currentPort = null;
let botUsername = 'BotUrolz'; 
let awaitingUsername = false; 

// --- Инлайн-клавиатура для управления ---
function getMainMenuKeyboard() {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: '▶️ Запустить бота', callback_data: 'start_bot' }, { text: '⏹ Выключить бота', callback_data: 'stop_bot' }],
                [{ text: '⚙️ Сменить сервер (домен:порт)', callback_data: 'set_server_prompt' }],
                [{ text: `👤 Сменить имя бота (Текущее: ${botUsername})`, callback_data: 'set_username_prompt' }]
            ]
        }
    };
}

// Переменные для управления переподключением
let reconnectAttempts = 0;
const maxReconnectAttempts = 100;
const reconnectInterval = 30000;
const resetAttemptsInterval = 60 * 60 * 1000;

setInterval(() => {
  console.log('Сбрасываю количество попыток переподключения.');
  reconnectAttempts = 0;
}, resetAttemptsInterval);

// --- Функции Mineflayer ---

function performRandomAction(mcBot) {
  if (!mcBot) return;
  
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

function createMinecraftBot() {
  if (reconnectAttempts >= maxReconnectAttempts) {
    bot.sendMessage(chatId, 'Превышено количество попыток подключения к Minecraft-серверу. Бот остановлен.');
    isBotStarted = false;
    return;
  }
  
  if (!currentHost || !currentPort) {
      bot.sendMessage(chatId, '❌ Не задан адрес сервера. Используйте команду /setserver.');
      isBotStarted = false;
      return;
  }

  if (mcBotInstance) {
      mcBotInstance.quit();
      mcBotInstance = null;
  }

  const botOptions = {
    host: currentHost,
    port: currentPort,
    username: botUsername, 
    version: false
  };

  const mcBot = mineflayer.createBot(botOptions);
  mcBotInstance = mcBot;
  let afkIntervalId = null; 

  mcBot.on('login', () => {
    bot.sendMessage(chatId, `✅ Бот **${botUsername}** подключился: ${currentHost}:${currentPort}`, { parse_mode: 'Markdown' });
    reconnectAttempts = 0;

    if (!afkIntervalId) {
      afkIntervalId = setInterval(() => {
          performRandomAction(mcBot);
      }, 60000);
    }

    setTimeout(() => {
      mcBot.chat('/register 1R2r3 1R2r3');
    }, 5000);
  });

  mcBot.on('end', (reason) => {
    bot.sendMessage(chatId, `❌ Бот был отключен (${reason}). Попытка переподключения.`);
    reconnectAttempts++;

    if (afkIntervalId) {
        clearInterval(afkIntervalId);
        afkIntervalId = null;
    }
    
    if (reconnectAttempts < maxReconnectAttempts) {
      setTimeout(createMinecraftBot, reconnectInterval);
    } else {
      bot.sendMessage(chatId, '❗️ Достигнуто максимальное количество попыток подключения. Бот остановлен.');
      isBotStarted = false;
    }
  });

  mcBot.on('error', (err) => {
    bot.sendMessage(chatId, `⚠️ Произошла ошибка: ${err.message}.`);
  });

  mcBot.on('death', () => {
    bot.sendMessage(chatId, '💀 Бот умер. Респавн...');
    setTimeout(() => {
      mcBot.respawn();
    }, 5000);
  });
  
  mcBot.on('players', (players) => {
    let botCount = 0;
    for (let player in players) {
      if (players[player] && players[player].username === botOptions.username) {
        botCount++;
      }
    }
    if (botCount > 1) {
      mcBot.quit();
      bot.sendMessage(chatId, '🚫 Обнаружен другой бот с тем же именем. Отключаюсь.');
    }
  });
}

// --- Хелперы для кнопок ---
function handleStopBot(msg) {
    if (isBotStarted && mcBotInstance) {
        mcBotInstance.quit();
        isBotStarted = false;
        mcBotInstance = null;
        bot.sendMessage(chatId, '⏹ Minecraft бот безопасно остановлен и отключен от сервера.');
    } else {
        bot.sendMessage(chatId, 'Бот не запущен.');
    }
}

function handleStartBot(msg) {
    if (!currentHost || !currentPort) {
        bot.sendMessage(chatId, '⚠️ Сначала задайте адрес сервера, используя кнопку "Сменить сервер".');
        return;
    }

    if (!isBotStarted) {
        bot.sendMessage(msg.chat.id, `Запускаю Minecraft бота **${botUsername}**...`, { parse_mode: 'Markdown' });
        createMinecraftBot();
        isBotStarted = true;

        // Таймер для отправки статуса каждые 60 минут
        setInterval(() => {
          if (isBotStarted) {
            bot.sendMessage(chatId, 'Minecraft бот работает нормально.');
          }
        }, 60 * 60 * 1000);
       
    } else {
        bot.sendMessage(msg.chat.id, 'Minecraft бот уже запущен.');
    }
}


// --- Обработка команд Telegram ---

// 1. Команда /menu или /start для отображения главного меню
bot.onText(/\/start|\/menu/, (msg) => {
    if (String(msg.chat.id) !== chatId) {
        bot.sendMessage(msg.chat.id, '❌ У вас нет прав для управления этим ботом.');
        return;
    }
    
    let statusText = isBotStarted ? '🟢 Подключен' : '🔴 Отключен';
    let serverText = currentHost ? `${currentHost}:${currentPort}` : 'Не задан';

    const messageText = `⚙️ **Панель управления ботом**\n\nСтатус: **${statusText}**\nСервер: **${serverText}**\nИмя бота: **${botUsername}**`;
    
    bot.sendMessage(chatId, messageText, { 
        parse_mode: 'Markdown', 
        reply_markup: getMainMenuKeyboard().reply_markup 
    });
});

// 2. Обработка нажатий на инлайн-кнопки
bot.on('callback_query', (query) => {
    const data = query.data;
    const msg = query.message;
    
    if (String(msg.chat.id) !== chatId) {
        bot.answerCallbackQuery(query.id, { text: 'Нет доступа.' });
        return;
    }
    
    bot.answerCallbackQuery(query.id); 

    switch (data) {
        case 'start_bot':
            handleStartBot(msg);
            break;
        case 'stop_bot':
            handleStopBot(msg);
            break;
        case 'set_server_prompt':
            bot.sendMessage(chatId, '💬 Отправьте адрес сервера в формате: `/setserver домен:порт` (например: `/setserver test.aternos.me:17484`)', { parse_mode: 'Markdown' });
            break;
        case 'set_username_prompt':
            awaitingUsername = true;
            bot.sendMessage(chatId, '💬 **Отправьте новое имя** для Minecraft бота. (Имя должно быть от 3 до 16 символов без пробелов)', { parse_mode: 'Markdown' });
            break;
    }
});

// 3. Команда /setserver для установки сервера
bot.onText(/\/setserver (.+)/, (msg, match) => {
    if (String(msg.chat.id) !== chatId) return;

    const fullAddress = match[1].trim();
    const parts = fullAddress.split(':');
    
    if (parts.length === 2 && parts[1].match(/^\d+$/)) {
        currentHost = parts[0].trim();
        currentPort = parseInt(parts[1].trim(), 10);
        
        bot.sendMessage(chatId, `✅ Сервер установлен: **${currentHost}:${currentPort}**.\nЗапустите бота через /menu.`, { parse_mode: 'Markdown' });
        
        if (isBotStarted && mcBotInstance) {
            handleStopBot(msg);
            bot.sendMessage(chatId, '🔄 Бот остановлен для применения новых настроек. Запустите его снова через /menu.');
        }

    } else {
        bot.sendMessage(chatId, '❌ Неверный формат. Используйте: `/setserver домен:порт`', { parse_mode: 'Markdown' });
    }
});

// 4. Обработка всех остальных сообщений (для захвата нового имени)
bot.on('message', (msg) => {
    // Игнорируем команды и сообщения, которые не пришли от нас или не ожидают ответа
    if (String(msg.chat.id) !== chatId || msg.text.startsWith('/')) return; 

    // Логика захвата нового имени
    if (awaitingUsername) {
        const newUsername = msg.text.trim();
        
        if (newUsername.length > 16 || newUsername.length < 3 || newUsername.includes(' ')) {
            bot.sendMessage(chatId, '❌ Имя должно быть от 3 до 16 символов и не содержать пробелов. Попробуйте снова.');
            return;
        }
        
        botUsername = newUsername;
        awaitingUsername = false;
        
        if (isBotStarted && mcBotInstance) {
            handleStopBot(msg);
            bot.sendMessage(chatId, `✅ Имя бота успешно изменено на **${botUsername}**. Бот был остановлен. Запустите его снова через /menu.`, { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, `✅ Имя бота успешно изменено на **${botUsername}**.\nЗапустите бота через /menu.`, { parse_mode: 'Markdown' });
        }
    }
});

// ... (Вся основная логика Mineflayer и Telegram бота до этого места остается прежней)

// 5. Обработчик для прослушивания порта Webhook
require('http').createServer((req, res) => {
  if (req.method === 'POST') {
    let body = '';
    
    // 1. Сборка тела запроса (потока данных)
    req.on('data', chunk => {
        body += chunk.toString();
    });

    // 2. Обработка запроса после получения всех данных
    req.on('end', () => {
      try {
        // Парсинг JSON-тела
        const update = JSON.parse(body); 
        
        // Передача обработанного объекта в TelegramBot
        bot.processUpdate(update);
        
        res.end('OK');
      } catch (error) {
        console.error('Ошибка парсинга JSON или обработки запроса:', error);
        res.statusCode = 500;
        res.end('Error processing request');
      }
    });
  } else {
    // Для GET-запросов (проверки статуса)
    res.end('OK');
  }
}).listen(port, () => {
    console.log(`Сервер Webhook запущен и слушает порт ${port}`);
});

// Очистка хука при остановке (помогает избежать конфликтов)
process.on('SIGINT', () => {
  console.log('Получен сигнал SIGINT. Удаление Webhook...');
  bot.deleteWebHook().then(() => {
    console.log('Webhook успешно удален. Завершение работы.');
    process.exit();
  });
});
