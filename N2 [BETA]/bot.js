const mineflayer = require('mineflayer');
const TelegramBot = require('node-telegram-bot-api');

// Telegram токен (замените на ваш токен)
const telegramToken = '7781049499:AAGAGCkjb_Cu_gs74UTtZ3nRU3sbjF3arGU';
const chatId = '860394745';  // Идентификатор чата, куда будут отправляться сообщения

// Инициализация Telegram бота
const bot = new TelegramBot(telegramToken, { polling: true });

// Статус бота
let isBotStarted = false;

// Настройки для подключения к серверу Minecraft
const botOptions = {
  host: '',  // Замените на ваше доменное имя сервера
  port: 24730,  // Порт по умолчанию для Minecraft-серверов
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
    return;
  }

  const mcBot = mineflayer.createBot(botOptions);

  mcBot.on('login', () => {
    console.log(`Minecraft бот подключился к серверу.`);
    bot.sendMessage(chatId, 'Minecraft бот подключился к серверу.');
    reconnectAttempts = 0;

    setTimeout(() => {
      mcBot.chat('/register 1R2r3 1R2r3');
      console.log('Отправлена команда: /register 1R2r3 1R2r3');
    }, 1000);
  });

  mcBot.on('end', () => {
    console.log('Minecraft бот отключен.');
    bot.sendMessage(chatId, 'Minecraft бот был отключен. Попытка переподключения.');
    reconnectAttempts++;

    if (reconnectAttempts < maxReconnectAttempts) {
      setTimeout(createMinecraftBot, reconnectInterval);
    } else {
      console.log('Достигнуто максимальное количество попыток подключения.');
    }
  });

  mcBot.on('error', (err) => {
    console.log('Произошла ошибка: ', err);
    bot.sendMessage(chatId, `Произошла ошибка: ${err.message}`);
  });

  mcBot.on('death', () => {
    console.log('Бот умер. Респавн через 5 секунд...');
    setTimeout(() => {
      mcBot.respawn();
      console.log('Бот респавнится.');
    }, 5000);
  });

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
    }
  });
}

// Обработка команды /start и ввода спецкода
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Привет! Введите специальный код для запуска Minecraft бота.');
});

bot.onText(/Ab1R/, (msg) => {
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
