const mineflayer = require('mineflayer');
const TelegramBot = require('node-telegram-bot-api');

// --- Переменные окружения для Render ---
const telegramToken = process.env.TELEGRAM_TOKEN;
const chatId = process.env.CHAT_ID;
const mcHost = process.env.MC_HOST;

if (!telegramToken || !chatId || !mcHost) {
  console.error('ОШИБКА: Не заданы необходимые переменные окружения: TELEGRAM_TOKEN, CHAT_ID, или MC_HOST.');
  process.exit(1);
}

const bot = new TelegramBot(telegramToken, { polling: true });

let isBotStarted = false;
let mcBotInstance = null;

const botOptions = {
  host: mcHost,
  port: 17484, // Ваш порт
  username: 'BotUrolz',
  version: false
};

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
  // Защита от сбоя: проверяем, что mcBot существует
  if (!mcBot) {
    return;
  }
  
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

// Функция создания Minecraft бота
function createMinecraftBot() {
  if (reconnectAttempts >= maxReconnectAttempts) {
    console.log('Превышено количество попыток подключения.');
    bot.sendMessage(chatId, 'Превышено количество попыток подключения к Minecraft-серверу. Бот остановлен.');
    return;
  }

  if (mcBotInstance) {
      mcBotInstance.quit();
  }

  const mcBot = mineflayer.createBot(botOptions);
  mcBotInstance = mcBot;
  let afkIntervalId = null; 

  mcBot.on('login', () => {
    console.log(`Minecraft бот подключился к серверу.`);
    bot.sendMessage(chatId, `✅ Minecraft бот подключился к серверу: ${mcHost}:${botOptions.port}`);
    reconnectAttempts = 0;

    // Запускаем Anti-AFK только после успешного входа
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
    bot.sendMessage(chatId, `❌ Minecraft бот был отключен (${reason}). Попытка переподключения.`);
    reconnectAttempts++;

    // Очищаем Anti-AFK при отключении
    if (afkIntervalId) {
        clearInterval(afkIntervalId);
        afkIntervalId = null;
    }
    
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

bot.onText(/\/start/, (msg) => {
  if (String(msg.chat.id) !== chatId) {
      bot.sendMessage(msg.chat.id, '❌ У вас нет прав для управления этим ботом.');
      return;
  }
  bot.sendMessage(msg.chat.id, 'Привет! Введите специальный код для запуска Minecraft бота.');
});

bot.onText(/Ab1R/, (msg) => {
  if (String(msg.chat.id) !== chatId) return;

  if (!isBotStarted) {
    bot.sendMessage(msg.chat.id, 'Код правильный. Запускаю Minecraft бота...');
    createMinecraftBot();
    isBotStarted = true;

    // Таймер для отправки статуса каждые 60 минут
    setInterval(() => {
      bot.sendMessage(chatId, 'Minecraft бот работает нормально.');
    }, 60 * 60 * 1000);
  } else {
    bot.sendMessage(msg.chat.id, 'Minecraft бот уже запущен.');
  }
});
