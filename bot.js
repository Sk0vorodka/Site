const mineflayer = require('mineflayer');
const TelegramBot = require('node-telegram-bot-api');

// --- Переменные окружения для Render ---
const telegramToken = process.env.TELEGRAM_TOKEN;
const port = process.env.PORT || 80; 
const url = process.env.RENDER_EXTERNAL_HOSTNAME;

// Ваш CHAT_ID из переменных окружения теперь используется только для первичного идентификатора (если нужен)
const adminChatId = process.env.CHAT_ID; 

if (!telegramToken || !url) {
  console.error('ОШИБКА: Не заданы необходимые переменные окружения: TELEGRAM_TOKEN или RENDER_EXTERNAL_HOSTNAME.');
  process.exit(1);
}

// --- Инициализация Telegram бота с Webhooks ---
const bot = new TelegramBot(telegramToken, { 
    polling: false
});

// Установка Webhook: Telegram будет отправлять обновления на этот адрес
bot.setWebHook(`https://${url}/bot${telegramToken}`, { allowed_updates: ["message", "callback_query"] });


// --- Глобальное состояние для Multi-User ---
/**
 * Хранит информацию о каждом боте:
 * Key: String (Chat ID пользователя)
 * Value: {
 * mcBot: Mineflayer Bot Instance,
 * host: String,
 * port: Number,
 * username: String,
 * awaitingUsername: Boolean,
 * reconnectAttempts: Number,
 * afkIntervalId: Interval ID
 * }
 */
const activeBots = {};

// Константы для переподключения
const maxReconnectAttempts = 100;
const reconnectInterval = 30000;
const resetAttemptsInterval = 60 * 60 * 1000;

// Сброс счетчика попыток для всех ботов раз в час
setInterval(() => {
  console.log('Сбрасываю количество попыток переподключения для всех активных ботов.');
  for (const chatId in activeBots) {
      activeBots[chatId].reconnectAttempts = 0;
  }
}, resetAttemptsInterval);


// --- Хелпер для данных пользователя ---

function getUserBotData(chatId) {
    const chatKey = String(chatId);
    if (!activeBots[chatKey]) {
        activeBots[chatKey] = {
            mcBot: null,
            host: null,
            port: null,
            username: `Bot${chatKey.slice(-4)}`, // Генерируем уникальное имя
            awaitingUsername: false,
            reconnectAttempts: 0,
            afkIntervalId: null
        };
    }
    return activeBots[chatKey];
}


// --- Функция для экранирования специальных символов Markdown ---
function escapeMarkdown(text) {
    if (!text) return '';
    // Экранируем символы, которые могут сломать Markdown V1
    return text.replace(/([_*\[\]()~`>#+=|{}.!-])/g, '\\$1');
}

// --- Инлайн-клавиатура для управления ---
function getMainMenuKeyboard(currentUsername) {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: '▶️ Запустить бота', callback_data: 'start_bot' }, { text: '⏹ Выключить бота', callback_data: 'stop_bot' }],
                [{ text: '⚙️ Сменить сервер (домен:порт)', callback_data: 'set_server_prompt' }],
                [{ text: `👤 Сменить имя бота (Текущее: ${currentUsername})`, callback_data: 'set_username_prompt' }]
            ]
        }
    };
}

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

function createMinecraftBot(chatId) {
  const data = getUserBotData(chatId);
  
  if (data.reconnectAttempts >= maxReconnectAttempts) {
    bot.sendMessage(chatId, 'Превышено количество попыток подключения к Minecraft-серверу. Бот остановлен.');
    data.mcBot = null;
    return;
  }
  
  if (!data.host || !data.port) {
      bot.sendMessage(chatId, '❌ Не задан адрес сервера. Используйте кнопку "Сменить сервер".');
      return;
  }

  // Если старый экземпляр еще есть, закрываем его
  if (data.mcBot) {
      data.mcBot.quit();
      data.mcBot = null;
      if (data.afkIntervalId) {
          clearInterval(data.afkIntervalId);
          data.afkIntervalId = null;
      }
  }

  const botOptions = {
    host: data.host,
    port: data.port,
    username: data.username, 
    version: false
  };

  const mcBot = mineflayer.createBot(botOptions);
  data.mcBot = mcBot;

  mcBot.on('login', () => {
    const escapedUsername = escapeMarkdown(data.username);
    const escapedHost = escapeMarkdown(data.host);
    
    bot.sendMessage(chatId, `✅ Бот **${escapedUsername}** подключился: ${escapedHost}:${data.port}`, { parse_mode: 'Markdown' });
    data.reconnectAttempts = 0;

    // Запускаем Anti-AFK
    if (!data.afkIntervalId) {
      data.afkIntervalId = setInterval(() => {
          performRandomAction(mcBot);
      }, 60000);
    }

    // Попытка регистрации
    setTimeout(() => {
      mcBot.chat('/register 1R2r3 1R2r3');
    }, 5000);
  });

  mcBot.on('end', (reason) => {
    bot.sendMessage(chatId, `❌ Бот был отключен (${reason}). Попытка переподключения.`);
    data.reconnectAttempts++;

    if (data.afkIntervalId) {
        clearInterval(data.afkIntervalId);
        data.afkIntervalId = null;
    }
    
    if (data.reconnectAttempts < maxReconnectAttempts) {
      setTimeout(() => createMinecraftBot(chatId), reconnectInterval);
    } else {
      bot.sendMessage(chatId, '❗️ Достигнуто максимальное количество попыток подключения. Бот остановлен.');
      data.mcBot = null;
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
function handleStopBot(chatId) {
    const data = getUserBotData(chatId);
    
    if (data.mcBot) {
        data.mcBot.quit();
        data.mcBot = null;
        if (data.afkIntervalId) {
            clearInterval(data.afkIntervalId);
            data.afkIntervalId = null;
        }
        bot.sendMessage(chatId, '⏹ Minecraft бот безопасно остановлен и отключен от сервера.');
    } else {
        bot.sendMessage(chatId, 'Бот не запущен.');
    }
}

function handleStartBot(chatId) {
    const data = getUserBotData(chatId);
    
    if (!data.host || !data.port) {
        bot.sendMessage(chatId, '⚠️ Сначала задайте адрес сервера, используя кнопку "Сменить сервер".');
        return;
    }

    if (!data.mcBot) {
        const escapedUsername = escapeMarkdown(data.username);
        
        bot.sendMessage(chatId, `Запускаю Minecraft бота **${escapedUsername}**...`, { parse_mode: 'Markdown' });
        createMinecraftBot(chatId);

        // Таймер для отправки статуса каждые 60 минут (только если его нет)
        if (!data.statusIntervalId) {
          data.statusIntervalId = setInterval(() => {
            if (data.mcBot) {
              bot.sendMessage(chatId, 'Minecraft бот работает нормально.');
            } else {
              clearInterval(data.statusIntervalId);
              data.statusIntervalId = null;
            }
          }, 60 * 60 * 1000);
        }
       
    } else {
        bot.sendMessage(chatId, 'Minecraft бот уже запущен.');
    }
}


// --- Обработка команд Telegram ---

// 1. Команда /menu или /start для отображения главного меню
bot.onText(/\/start|\/menu/, (msg) => {
    const userChatId = String(msg.chat.id);
    const data = getUserBotData(userChatId);
    
    const isBotRunning = data.mcBot !== null;
    let statusText = isBotRunning ? '🟢 Подключен' : '🔴 Отключен';
    
    // Экранирование для отображения в меню
    let escapedHost = escapeMarkdown(data.host);
    let escapedUsername = escapeMarkdown(data.username);
    let serverText = data.host ? `${escapedHost}:${data.port}` : 'Не задан'; 

    const messageText = `⚙️ **Панель управления ботом**\n\nСтатус: **${statusText}**\nСервер: **${serverText}**\nИмя бота: **${escapedUsername}**`;
    
    bot.sendMessage(userChatId, messageText, { 
        parse_mode: 'Markdown', 
        reply_markup: getMainMenuKeyboard(data.username).reply_markup 
    });
});

// 2. Обработка нажатий на инлайн-кнопки
bot.on('callback_query', (query) => {
    const dataQuery = query.data;
    const userChatId = String(query.message.chat.id);
    
    bot.answerCallbackQuery(query.id); 

    switch (dataQuery) {
        case 'start_bot':
            handleStartBot(userChatId);
            break;
        case 'stop_bot':
            handleStopBot(userChatId);
            break;
        case 'set_server_prompt':
            bot.sendMessage(userChatId, '💬 Отправьте адрес сервера в формате: `/setserver домен:порт` (например: `/setserver test.aternos.me:17484`)', { parse_mode: 'Markdown' });
            break;
        case 'set_username_prompt':
            getUserBotData(userChatId).awaitingUsername = true;
            bot.sendMessage(userChatId, '💬 **Отправьте новое имя** для Minecraft бота. (Имя должно быть от 3 до 16 символов без пробелов)', { parse_mode: 'Markdown' });
            break;
    }
});

// 3. Команда /setserver для установки сервера
bot.onText(/\/setserver (.+)/, (msg, match) => {
    const userChatId = String(msg.chat.id);
    const data = getUserBotData(userChatId);

    const fullAddress = match[1].trim();
    const parts = fullAddress.split(':');
    
    if (parts.length === 2 && parts[1].match(/^\d+$/)) {
        data.host = parts[0].trim();
        data.port = parseInt(parts[1].trim(), 10);
        
        const escapedHost = escapeMarkdown(data.host);
        
        bot.sendMessage(userChatId, `✅ Сервер установлен: **${escapedHost}:${data.port}**.\nЗапустите бота через /menu.`, { parse_mode: 'Markdown' });
        
        if (data.mcBot) {
            handleStopBot(userChatId);
            bot.sendMessage(userChatId, '🔄 Бот остановлен для применения новых настроек. Запустите его снова через /menu.');
        }

    } else {
        bot.sendMessage(userChatId, '❌ Неверный формат. Используйте: `/setserver домен:порт`', { parse_mode: 'Markdown' });
    }
});

// 4. Обработка всех остальных сообщений (для захвата нового имени)
bot.on('message', (msg) => {
    const userChatId = String(msg.chat.id);
    const data = getUserBotData(userChatId);
    
    // Игнорируем команды
    if (msg.text && msg.text.startsWith('/')) return; 

    // Логика захвата нового имени
    if (data.awaitingUsername) {
        const newUsername = msg.text.trim();
        
        if (newUsername.length > 16 || newUsername.length < 3 || newUsername.includes(' ')) {
            bot.sendMessage(userChatId, '❌ Имя должно быть от 3 до 16 символов и не содержать пробелов. Попробуйте снова.');
            return;
        }
        
        data.username = newUsername;
        data.awaitingUsername = false;
        
        const escapedUsername = escapeMarkdown(data.username);
        
        if (data.mcBot) {
            handleStopBot(userChatId);
            bot.sendMessage(userChatId, `✅ Имя бота успешно изменено на **${escapedUsername}**. Бот был остановлен. Запустите его снова через /menu.`, { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(userChatId, `✅ Имя бота успешно изменено на **${escapedUsername}**.\nЗапустите бота через /menu.`, { parse_mode: 'Markdown' });
        }
    }
});

// 5. Обработчик для прослушивания порта Webhook
// ВНИМАНИЕ: Это исправленный блок для парсинга JSON
require('http').createServer((req, res) => {
  if (req.method === 'POST') {
    let body = '';
    
    req.on('data', chunk => {
        body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const update = JSON.parse(body); 
        bot.processUpdate(update);
        res.end('OK');
      } catch (error) {
        console.error('Ошибка парсинга JSON или обработки запроса:', error.message);
        res.statusCode = 200; 
        res.end('OK');
      }
    });
  } else {
    // Для GET-запросов (проверки статуса)
    res.end('OK');
  }
}).listen(port, () => {
    console.log(`Сервер Webhook запущен и слушает порт ${port}`);
});

// Очистка хука при остановке 
process.on('SIGINT', () => {
  console.log('Получен сигнал SIGINT. Удаление Webhook и остановка всех Mineflayer ботов...');
  
  // Остановка всех Mineflayer ботов перед завершением
  for (const chatId in activeBots) {
      if (activeBots[chatId].mcBot) {
          activeBots[chatId].mcBot.quit();
          if (activeBots[chatId].afkIntervalId) {
              clearInterval(activeBots[chatId].afkIntervalId);
          }
      }
  }

  bot.deleteWebHook().then(() => {
    console.log('Webhook успешно удален. Завершение работы.');
    process.exit();
  });
});
