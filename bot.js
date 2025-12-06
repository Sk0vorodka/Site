const mineflayer = require('mineflayer');
const TelegramBot = require('node-telegram-bot-api');

// --- Переменные окружения для Render ---
const telegramToken = process.env.TELEGRAM_TOKEN;
const port = process.env.PORT || 80; 
const url = process.env.RENDER_EXTERNAL_HOSTNAME;

// Ваш CHAT_ID из переменных окружения
const adminChatId = process.env.CHAT_ID; 

if (!telegramToken || !url) {
  console.error('ОШИБКА: Не заданы необходимые переменные окружения: TELEGRAM_TOKEN или RENDER_EXTERNAL_HOSTNAME.');
  process.exit(1);
}

// --- Инициализация Telegram бота с Webhooks ---
const bot = new TelegramBot(telegramToken, { 
    polling: false
});

// Установка Webhook
bot.setWebHook(`https://${url}/bot${telegramToken}`, { allowed_updates: ["message", "callback_query"] });


// --- Глобальное состояние для Multi-User ---
const activeBots = {};
const maxReconnectAttempts = 100;
const reconnectInterval = 30000;
const resetAttemptsInterval = 60 * 60 * 1000;


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
            afkIntervalId: null,
            statusIntervalId: null,
            sendNotifications: true // NEW: Уведомления включены по умолчанию
        };
    }
    return activeBots[chatKey];
}


// Сброс счетчика попыток для всех ботов раз в час
setInterval(() => {
  console.log('Сбрасываю количество попыток переподключения для всех активных ботов.');
  for (const chatId in activeBots) {
      activeBots[chatId].reconnectAttempts = 0;
  }
}, resetAttemptsInterval);


// --- Функция для экранирования специальных символов Markdown ---
function escapeMarkdown(text) {
    if (!text) return '';
    return text.replace(/([_*\[\]()~`>#+=|{}.!-])/g, '\\$1');
}

// --- Инлайн-клавиатура для управления ---
function getMainMenuKeyboard(currentUsername, notificationsEnabled) {
    const notifText = notificationsEnabled ? '🔕 Выключить уведомления' : '🔔 Включить уведомления';
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: '▶️ Запустить бота', callback_data: 'start_bot' }, { text: '⏹ Выключить бота', callback_data: 'stop_bot' }],
                [{ text: '⚙️ Сменить сервер (домен:порт)', callback_data: 'set_server_prompt' }],
                [{ text: `👤 Сменить имя бота (Текущее: ${currentUsername})`, callback_data: 'set_username_prompt' }],
                [{ text: notifText, callback_data: 'toggle_notifications' }] // НОВАЯ КНОПКА
            ]
        }
    };
}

// --- Функции Mineflayer (Anti-AFK) ---

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

// --- ФУНКЦИИ УПРАВЛЕНИЯ БОТОМ (Исправлено) ---

function handleStopBot(chatId) {
    const data = getUserBotData(chatId);
    
    if (data.mcBot) {
        // Защита от падений
        if (typeof data.mcBot.quit === 'function') { 
            data.mcBot.quit();
        } else {
            console.warn(`[Chat ID ${chatId}] data.mcBot существует, но не имеет метода quit(). Очистка ссылки.`);
        }
        data.mcBot = null;
        
        // Очистка всех интервалов
        if (data.afkIntervalId) {
            clearInterval(data.afkIntervalId);
            data.afkIntervalId = null;
        }
        if (data.statusIntervalId) { 
            clearInterval(data.statusIntervalId);
            data.statusIntervalId = null;
        }

        if (data.sendNotifications) {
            bot.sendMessage(chatId, '⏹ Minecraft бот безопасно остановлен и отключен от сервера.');
        }
    } else {
        bot.sendMessage(chatId, 'Бот не запущен.');
    }
}

function createMinecraftBot(chatId) {
  const data = getUserBotData(chatId);
  
  if (data.reconnectAttempts >= maxReconnectAttempts) {
    if (data.sendNotifications) {
        bot.sendMessage(chatId, 'Превышено количество попыток подключения к Minecraft-серверу. Бот остановлен.');
    }
    data.mcBot = null;
    return;
  }
  
  if (!data.host || !data.port) {
      bot.sendMessage(chatId, '❌ Не задан адрес сервера. Используйте кнопку "Сменить сервер".');
      return;
  }

  // Очистка старого экземпляра
  handleStopBot(chatId); // Используем handleStopBot для безопасной очистки

  const botOptions = {
    host: data.host,
    port: data.port,
    username: data.username, 
    version: false
  };

  try {
      const mcBot = mineflayer.createBot(botOptions);
      data.mcBot = mcBot;

      mcBot.on('login', () => {
        const escapedUsername = escapeMarkdown(data.username);
        const escapedHost = escapeMarkdown(data.host);
        
        if (data.sendNotifications) {
            bot.sendMessage(chatId, `✅ Бот **${escapedUsername}** подключился: ${escapedHost}:${data.port}`, { parse_mode: 'Markdown' });
        }
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
        if (data.sendNotifications) {
            bot.sendMessage(chatId, `❌ Бот был отключен (${reason}). Попытка переподключения.`);
        }
        data.reconnectAttempts++;

        if (data.afkIntervalId) {
            clearInterval(data.afkIntervalId);
            data.afkIntervalId = null;
        }
        
        if (data.reconnectAttempts < maxReconnectAttempts) {
          setTimeout(() => createMinecraftBot(chatId), reconnectInterval);
        } else {
          if (data.sendNotifications) {
            bot.sendMessage(chatId, '❗️ Достигнуто максимальное количество попыток подключения. Бот остановлен.');
          }
          data.mcBot = null;
        }
      });

      mcBot.on('error', (err) => {
        if (data.sendNotifications) {
            bot.sendMessage(chatId, `⚠️ Произошла ошибка: ${err.message}.`);
        }
        
        // В случае критической ошибки, пытаемся завершить и очистить ссылку
        if (data.mcBot && typeof data.mcBot.quit === 'function') {
           data.mcBot.quit(); 
        }
        data.mcBot = null; 
      });

      mcBot.on('death', () => {
        if (data.sendNotifications) {
            bot.sendMessage(chatId, '💀 Бот умер. Респавн...');
        }
        setTimeout(() => {
          if (data.mcBot) {
            data.mcBot.respawn();
          }
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
          if (data.mcBot && typeof data.mcBot.quit === 'function') {
             data.mcBot.quit();
          }
          if (data.sendNotifications) {
            bot.sendMessage(chatId, '🚫 Обнаружен другой бот с тем же именем. Отключаюсь.');
          }
        }
      });

  } catch (err) {
      // Ловим синхронные ошибки (например, неверные опции)
      console.error(`[Chat ID ${chatId}] Критическая ошибка при создании Mineflayer бота: ${err.message}`);
      data.mcBot = null;
      bot.sendMessage(chatId, `❌ Не удалось создать Mineflayer бота. Проверьте адрес сервера. Ошибка: ${err.message}`);
      
      data.reconnectAttempts++;
      if (data.reconnectAttempts < maxReconnectAttempts) {
          setTimeout(() => createMinecraftBot(chatId), reconnectInterval);
      }
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

        // Таймер для отправки статуса каждые 60 минут
        if (!data.statusIntervalId) {
          data.statusIntervalId = setInterval(() => {
            if (data.mcBot && data.sendNotifications) {
              bot.sendMessage(chatId, 'Minecraft бот работает нормально.');
            } else if (!data.mcBot) {
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
    let notifStatus = data.sendNotifications ? 'Включены (🔔)' : 'Выключены (🔕)';
    
    // Экранирование для отображения в меню
    let escapedHost = escapeMarkdown(data.host);
    let escapedUsername = escapeMarkdown(data.username);
    let serverText = data.host ? `${escapedHost}:${data.port}` : 'Не задан'; 

    const messageText = `⚙️ **Панель управления ботом**\n\nСтатус: **${statusText}**\nСервер: **${serverText}**\nИмя бота: **${escapedUsername}**\nУведомления: **${notifStatus}**`;
    
    bot.sendMessage(userChatId, messageText, { 
        parse_mode: 'Markdown', 
        reply_markup: getMainMenuKeyboard(data.username, data.sendNotifications).reply_markup 
    });
});

// 2. Обработка нажатий на инлайн-кнопки
bot.on('callback_query', (query) => {
    const dataQuery = query.data;
    const userChatId = String(query.message.chat.id);
    const data = getUserBotData(userChatId);
    
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
            data.awaitingUsername = true;
            bot.sendMessage(userChatId, '💬 **Отправьте новое имя** для Minecraft бота. (Имя должно быть от 3 до 16 символов без пробелов)', { parse_mode: 'Markdown' });
            break;
        case 'toggle_notifications': // NEW HANDLER
            data.sendNotifications = !data.sendNotifications;
            const status = data.sendNotifications ? 'ВКЛЮЧЕНЫ (🔔). Вы будете получать сообщения о подключении/отключении.' : 'ВЫКЛЮЧЕНЫ (🔕). Бот будет работать тихо.';
            bot.sendMessage(userChatId, `✅ Уведомления успешно **${status}**`);
            // Обновить меню, чтобы показать новый статус
            bot.editMessageReplyMarkup(
                getMainMenuKeyboard(data.username, data.sendNotifications).reply_markup,
                { chat_id: userChatId, message_id: query.message.message_id }
            );
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
    
    if (msg.text && msg.text.startsWith('/')) return; 

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
    res.end('OK');
  }
}).listen(port, () => {
    console.log(`Сервер Webhook запущен и слушает порт ${port}`);
});

// Очистка хука при остановке 
process.on('SIGINT', () => {
  console.log('Получен сигнал SIGINT. Удаление Webhook и остановка всех Mineflayer ботов...');
  
  for (const chatId in activeBots) {
      handleStopBot(chatId); // Используем общую функцию остановки
  }

  bot.deleteWebHook().then(() => {
    console.log('Webhook успешно удален. Завершение работы.');
    process.exit();
  });
});
