const mineflayer = require('mineflayer');
const TelegramBot = require('node-telegram-bot-api');

// --- Переменные окружения для Render ---
// Секретный токен Telegram
const telegramToken = process.env.TELEGRAM_TOKEN;
// ID чата, куда будут отправляться сообщения (важно: этот чат_id должен быть вашим!)
const chatId = process.env.CHAT_ID;
// Хост Minecraft сервера (например, "вашсервер.aternos.me")
const mcHost = process.env.MC_HOST;

if (!telegramToken || !chatId || !mcHost) {
  console.error('ОШИБКА: Не заданы необходимые переменные окружения: TELEGRAM_TOKEN, CHAT_ID, или MC_HOST.');
  process.exit(1);
}

// Инициализация Telegram бота
// ВАЖНО: polling: true подходит для локального запуска. Для Render лучше использовать webhooks,
// но для простого бота-уведомителя polling часто работает, если не используется HTTP-сервер.
const bot = new TelegramBot(telegramToken, { polling: true });

// Статус бота
let isBotStarted = false;
let mcBotInstance = null; // Для хранения текущего экземпляра mineflayer

// Настройки для подключения к серверу Minecraft
const botOptions = {
  host: mcHost,  // Используем переменную окружения
  port: 24730,  // Порт по умолчанию для Aternos
  username: 'BotUrolz',  // Имя бота 
  version: false  // Автоматический выбор версии Minecraft
};

// Переменные для управления переподключением
let reconnectAttempts = 0;
const maxReconnectAttempts = 100;
const reconnectInterval = 30000;
const resetAttemptsInterval = 60 * 60 * 1000;

// Таймер для сброса количества попыток
setInterval(() => {
  console.log('Сбрасываю количество попыток переподключения.');
  reconnectAttempts = 0;
}, resetAttemptsInterval);

// Функция создания Minecraft бота
function createMinecraftBot() {
  if (reconnectAttempts >= maxReconnectAttempts) {
    console.log('Превышено количество попыток подключения.');
    bot.sendMessage(chatId, 'Превышено количество попыток подключения к Minecraft-серверу. Бот остановлен.');
    return;
  }

  // Завершаем предыдущий экземпляр перед созданием нового
  if (mcBotInstance) {
      mcBotInstance.quit();
  }

  const mcBot = mineflayer.createBot(botOptions);
  mcBotInstance = mcBot; // Сохраняем новый экземпляр

  mcBot.on('login', () => {
    console.log(`Minecraft бот подключился к серверу.`);
    bot.sendMessage(chatId, `✅ Minecraft бот подключился к серверу: ${mcHost}`);
    reconnectAttempts = 0;

    // Регистрация на сервере 
    setTimeout(() => {
      mcBot.chat('/register 1R2r3 1R2r3');
      console.log('Отправлена команда: /register 1R2r3 1R2r3');
    }, 5000); // Даем время на подключение
  });

  mcBot.on('end', (reason) => {
    console.log(`Minecraft бот отключен. Причина: ${reason}`);
    bot.sendMessage(chatId, `❌ Minecraft бот был отключен (${reason}). Попытка переподключения.`);
    reconnectAttempts++;

    if (reconnectAttempts < maxReconnectAttempts) {
      setTimeout(createMinecraftBot, reconnectInterval);
    } else {
      console.log('Достигнуто максимальное количество попыток подключения.');
      bot.sendMessage(chatId, '❗️ Достигнуто максимальное количество попыток подключения. Бот остановлен.');
    }
  });

  mcBot.on('error', (err) => {
    console.error('Произошла ошибка: ', err.message);
    bot.sendMessage(chatId, `⚠️ Произошла ошибка: ${err.message}.`);
  });

  mcBot.on('death', () => {
    console.log('Бот умер. Респавн через 5 секунд...');
    bot.sendMessage(chatId, '💀 Бот умер. Респавн...');
    setTimeout(() => {
      mcBot.respawn();
      console.log('Бот респавнится.');
    }, 5000);
  });
  
  // Anti-AFK логика 
  setInterval(() => {
    performRandomAction(mcBot);
  }, 60000);

  function performRandomAction(mcBot) {
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

  // Логика обнаружения клона 
  mcBot.on('players', (players) => {
    let botCount = 0;
    for (let player in players) {
      if (players[player] && players[player].username === botOptions.username) {
        botCount++;
      }
    }
    if (botCount > 1) {
      console.log('Обнаружен другой бот с тем же именем. Отключаюсь.');
      mcBot.quit();
      bot.sendMessage(chatId, '🚫 Обнаружен другой бот с тем же именем. Отключаюсь.');
    }
  });
}

// --- Обработка команд Telegram ---

// Обработка команды /start
bot.onText(/\/start/, (msg) => {
  // Проверяем, что сообщение пришло от доверенного CHAT_ID
  if (String(msg.chat.id) !== chatId) {
      bot.sendMessage(msg.chat.id, '❌ У вас нет прав для управления этим ботом.');
      return;
  }
  bot.sendMessage(msg.chat.id, 'Привет! Введите специальный код для запуска Minecraft бота.');
});

// Обработка специального кода для запуска 
bot.onText(/Ab1R/, (msg) => {
  // Проверяем, что сообщение пришло от доверенного CHAT_ID
  if (String(msg.chat.id) !== chatId) return;

  if (!isBotStarted) {
    bot.sendMessage(msg.chat.id, 'Код правильный. Запускаю Minecraft бота...');
    createMinecraftBot();
    isBotStarted = true;

    // Таймер для отправки статуса каждые 60 минут 
    setInterval(() => {
      bot.sendMessage(chatId, 'Minecraft бот работает нормально.');
    }, 60 * 60 * 1000);  // 60 минут
  } else {
    bot.sendMessage(msg.chat.id, 'Minecraft бот уже запущен.');
  }
});