const TelegramBot = require('node-telegram-bot-api');

// Вставьте ваш токен бота
const token = '7781049499:AAGAGCkjb_Cu_gs74UTtZ3nRU3sbjF3arGU';

// Создаём экземпляр бота
const bot = new TelegramBot(token, { polling: true });

// Обрабатываем любые сообщения от пользователя
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  console.log(`Ваш chat_id: ${chatId}`);

  // Отправляем сообщение с chat_id
  bot.sendMessage(chatId, `Ваш chat_id: ${chatId}`);
});
