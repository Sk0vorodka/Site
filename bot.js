// ... (Остальная часть кода до функции createMinecraftBot остается прежней)

  // Функция Anti-AFK
  function performRandomAction(mcBot) {
    // ⬅️ ДОБАВЛЕНА ПРОВЕРКА: Если mcBot не существует или не готов, выходим
    if (!mcBot || mcBot.botStatus !== 'connected') { 
        console.log('Anti-AFK пропущен: бот не подключен.');
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

  // Anti-AFK логика
  let afkIntervalId = null; // ⬅️ Сохраняем ID интервала
  
  mcBot.on('login', () => {
    // ...
    // Запускаем Anti-AFK только после успешного входа
    afkIntervalId = setInterval(() => {
        performRandomAction(mcBot);
    }, 60000);
  });
  
  mcBot.on('end', (reason) => {
    // ...
    // Очищаем Anti-AFK при отключении
    if (afkIntervalId) {
        clearInterval(afkIntervalId);
        afkIntervalId = null;
    }
    // ...
  });
  
  // ... (Остальная часть кода createMinecraftBot)
}
// ... (Конец файла)
