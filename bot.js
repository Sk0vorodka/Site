const mineflayer = require('mineflayer');
const TelegramBot = require('node-telegram-bot-api');

// --- Переменные окружения для Render (Только для доступа!) ---
// Мы оставляем здесь только токен и chat_id, чтобы бот мог работать и отправлять уведомления
const telegramToken = process.env.TELEGRAM_TOKEN;
const chatId = process.env.CHAT_ID;

if (!telegramToken || !chatId) {
  console.error('ОШИБКА: Не заданы необходимые переменные окружения: TELEGRAM_TOKEN или CHAT_ID.');
  process.exit(1);
}

const bot = new TelegramBot(telegramToken, { polling: true });

// --- Переменные для хранения настроек сервера ---
let isBotStarted = false;
let mcBotInstance = null;
let currentHost = null;
let currentPort = null;
const botUsername = 'BotUrolz'; // Имя бота остается постоянным

// Переменные для управления переподключением
let reconnectAttempts = 0;
const maxReconnectAttempts = 100;
const reconnectInterval = 30000;
const resetAttemptsInterval = 60 * 60 * 1000;

setInterval(() => {
  console.log('Сбрасываю количество попыток переподключения.');
  reconnectAttempts = 0;
}, resetAttemptsInterval);

// Функция для Anti-AFK
function performRandomAction(mcBot) {
  if (!mcBot) {
    return;
  }
  // ... (логика Anti-AFK остается прежней)
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


// Функция создания Minecraft бота (теперь использует глобальные переменные)
function createMinecraftBot() {
  if (reconnectAttempts >= maxReconnectAttempts) {
    bot.sendMessage(chatId, 'Превышено количество попыток подключения к Minecraft-серверу. Бот остановлен.');
    return;
  }
  
  // Проверка, установлены ли хост и порт
  if (!currentHost || !currentPort) {
      bot.sendMessage(chatId, '❌ Не задан адрес сервера. Используйте команду /setserver.');
      isBotStarted = false;
      return;
  }

  if (mcBotInstance) {
      mcBotInstance.quit();
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
    console.log(`Minecraft бот подключился к серверу.`);
    bot.sendMessage(chatId, `✅ Бот подключился: ${currentHost}:${currentPort}`);
    reconnectAttempts = 0;

    // Запускаем Anti-AFK
    if (!afkIntervalId) {
      afkIntervalId = setInterval(() => {
          performRandomAction(mcBot);
      }, 60000);
    }

    setTimeout(() => {
      mcBot.chat('/register 1R2r3 1R2r3');
      console.log('Отправлена команда: /register 1R2r3 1R2r3');
    }, 5000);
  });

  mcBot.on('end', (reason) => {
    console.log(`Minecraft бот отключен. Причина: ${reason}`);
    bot.sendMessage(chatId, `❌ Бот был отключен (${reason}). Попытка переподключения.`);
    reconnectAttempts++;

    if (afkIntervalId) {
        clearInterval(afkIntervalId);
        afkIntervalId = null;
    }
    
    if (reconnectAttempts < maxReconnectAttempts) {
      setTimeout(createMinecraftBot, reconnectInterval);
    } else {
      console.log('Достигнуто максимальное количество попыток подключения.');
      bot.sendMessage(chatId, '❗️ Достигнуто максимальное количество попыток подключения. Бот остановлен.');
      isBotStarted = false;
    }
  });

  mcBot.on('error', (err) => {
    console.error('Произошла ошибка: ', err.message);
    bot.sendMessage(chatId, `⚠️ Произошла ошибка: ${err.message}.`);
  });

  mcBot.on('death', () => {
    bot.sendMessage(chatId, '💀 Бот умер. Респавн...');
    setTimeout(() => {
      mcBot.respawn();
    }, 5000);
  });
  
  // Логика обнаружения клона
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

// --- Обработка команд Telegram ---

// 1. Команда для установки сервера
bot.onText(/\/setserver (.+)/, (msg, match) => {
    if (String(msg.chat.id) !== chatId) return;

    const fullAddress = match[1].trim();
    const parts = fullAddress.split(':');
    
    if (parts.length === 2 && parts[1].match(/^\d+$/)) {
        currentHost = parts[0].trim();
        currentPort = parseInt(parts[1].trim(), 10);
        
        bot.sendMessage(chatId, `✅ Сервер установлен: **${currentHost}:${currentPort}**.\nТеперь вы можете запустить бота командой /start.`, { parse_mode: 'Markdown' });
        
        // Если бот уже был запущен, перезапускаем его с новыми данными
        if (isBotStarted) {
            if (mcBotInstance) mcBotInstance.quit();
            isBotStarted = false;
            bot.sendMessage(chatId, '🔄 Перезапускаю бота с новыми настройками...');
            // Запуск произойдет через команду Ab1R, которую нужно будет отправить повторно
        }

    } else {
        bot.sendMessage(chatId, '❌ Неверный формат. Используйте: `/setserver домен:порт` (например: `/setserver test.aternos.me:17484`)', { parse_mode: 'Markdown' });
    }
});

// 2. Команда /start
bot.onText(/\/start/, (msg) => {
  if (String(msg.chat.id) !== chatId) {
      bot.sendMessage(msg.chat.id, '❌ У вас нет прав для управления этим ботом.');
      return;
  }
  
  if (!currentHost || !currentPort) {
      bot.sendMessage(chatId, '⚠️ Сначала задайте адрес сервера, используя команду: `/setserver домен:порт`', { parse_mode: 'Markdown' });
      return;
  }
  
  bot.sendMessage(msg.chat.id, 'Введите специальный код для запуска Minecraft бота.');
});

// 3. Команда Ab1R (запуск)
bot.onText(/Ab1R/, (msg) => {
  if (String(msg.chat.id) !== chatId) return;
  
  if (!currentHost || !currentPort) {
       bot.sendMessage(chatId, '⚠️ Сначала задайте адрес сервера, используя команду: `/setserver домен:порт`', { parse_mode: 'Markdown' });
      return;
  }

  if (!isBotStarted) {
    bot.sendMessage(msg.chat.id, 'Код правильный. Запускаю Minecraft бота...');
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
});
