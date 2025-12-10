import os
import json
import logging
import requests
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application,
    CommandHandler,
    CallbackQueryHandler,
    ContextTypes,
    MessageHandler,
    filters 
    # JobQueue УДАЛЕН
)

# Настройка логирования
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ======================================================================
# --- ⚠️ КОНФИГУРАЦИЯ ---
TELEGRAM_TOKEN = "8596622001:AAE7NxgyUEQ-mZqTMolt7Kgs2ouM0QyjdIE" 
WORKER_API_URL = "https://site-3-8fj7.onrender.com" 
# ======================================================================


# Проверка конфигурации
if not all([TELEGRAM_TOKEN, WORKER_API_URL]):
    logger.error("ОШИБКА: Не заданы все необходимые переменные конфигурации.")
    exit(1)


# --- Глобальное состояние ---
USER_DATA = {}
DATA_FILE = "data.json"
tg_app = None 


# ----------------------------------------------------------------------
#                         ФУНКЦИИ УПРАВЛЕНИЯ ДАННЫМИ
# ----------------------------------------------------------------------

def load_data():
    """Загружает данные пользователей из файла."""
    global USER_DATA
    try:
        if os.path.exists(DATA_FILE):
            with open(DATA_FILE, 'r', encoding='utf-8') as f:
                USER_DATA = json.load(f)
            logger.info("Настройки ботов успешно загружены.")
        else:
            logger.info("Файл настроек не найден. Начинаем с чистого листа.")
            USER_DATA = {}
    except json.JSONDecodeError:
        logger.warning("Ошибка декодирования JSON. Начинаем с чистого листа.")
        USER_DATA = {}
    except Exception as e:
        logger.error(f"Ошибка при загрузке настроек: {e}")
        USER_DATA = {}

def save_data():
    """Сохраняет данные пользователей в файл."""
    try:
        with open(DATA_FILE, 'w', encoding='utf-8') as f:
            json.dump(USER_DATA, f, ensure_ascii=False, indent=4)
        logger.info("Настройки ботов успешно сохранены.")
    except Exception as e:
        logger.error(f"Ошибка при сохранении настроек: {e}")

def get_user_data(chat_id):
    """Возвращает или инициализирует данные пользователя."""
    chat_id_str = str(chat_id)
    if chat_id_str not in USER_DATA:
        USER_DATA[chat_id_str] = {
            "host": None,
            "port": None,
            "username": f"Bot{chat_id_str[-4:]}",
            "awaiting_username": False,
            "awaiting_command": False,
            "send_notifications": True,
            "is_running": False,
            "version": "1.20.1", 
        }
        save_data()
    
    # Защита: Добавляем недостающие поля
    if "version" not in USER_DATA[chat_id_str]:
        USER_DATA[chat_id_str]["version"] = "1.20.1"
        save_data()
        
    if "awaiting_command" not in USER_DATA[chat_id_str]:
        USER_DATA[chat_id_str]["awaiting_command"] = False
        
    if "send_notifications" not in USER_DATA[chat_id_str]:
        USER_DATA[chat_id_str]["send_notifications"] = True
        
    return USER_DATA[chat_id_str]

# ----------------------------------------------------------------------
#                           ИНЛАЙН-КЛАВИАТУРА И ФОРМАТИРОВАНИЕ
# ----------------------------------------------------------------------

def escape_markdown(text):
    """Экранирует символы Markdown V2."""
    if not text:
        return ''
    # Экранируем символы: _, *, [, ], (, ), ~, `, >, #, +, -, =, |, {, }, ., !
    chars_to_escape = r'_*[]()~`>#+-=|{}.!'
    return "".join(['\\' + char if char in chars_to_escape else char for char in str(text)])


def get_main_menu_keyboard(username, notifications_enabled, is_running):
    """
    Формирует главное меню с контекстно-зависимой кнопкой запуска/остановки.
    """
    notif_text = '🔕 Выключить уведомления' if notifications_enabled else '🔔 Включить уведомления'
    
    if is_running:
        status_button = InlineKeyboardButton("⏹ Остановить бота", callback_data="stop_bot")
    else:
        status_button = InlineKeyboardButton("▶️ Запустить бота", callback_data="start_bot")
    
    keyboard = [
        [
            status_button 
        ],
        [
            InlineKeyboardButton("⚙️ Сменить сервер (домен:порт)", callback_data="set_server_prompt"),
            InlineKeyboardButton("✨ Сменить версию", callback_data="set_version_prompt")
        ],
        [
            InlineKeyboardButton("👤 Сменить имя бота", callback_data="set_username_prompt")
        ],
        [
            InlineKeyboardButton(notif_text, callback_data="toggle_notifications")
        ],
        [
            InlineKeyboardButton("💬 Отправить команду", callback_data="send_command_prompt"), 
            InlineKeyboardButton("♻️ Обновить статус", callback_data="refresh_status")
        ]
    ]
    return InlineKeyboardMarkup(keyboard)

# ----------------------------------------------------------------------
#               KICKSTAND JOB QUEUE УДАЛЕНА ИЗ MAIN.PY
# ----------------------------------------------------------------------


# ----------------------------------------------------------------------
#                           ВЗАИМОДЕЙСТВИЕ С WORKER'ОМ
# ----------------------------------------------------------------------

async def get_worker_status(chat_id):
    """Получает фактический статус Mineflayer бота с Worker Service."""
    try:
        response = requests.get(f"{WORKER_API_URL}/api/status/{chat_id}", timeout=5)
        if response.status_code == 200:
            return response.json().get("isRunning", False)
    except requests.exceptions.RequestException:
        pass
    return False


async def start_worker_bot(chat_id, host, port, username):
    """Отправляет команду на запуск Mineflayer-Worker."""
    data = get_user_data(chat_id)
    chat_id_str = str(chat_id)
    
    if host is None or port is None:
        return False, "⚠️ \\*Ошибка конфигурации\\*\\: Адрес сервера не задан в настройках\\."

    payload = {
        "chatId": chat_id_str,
        "host": host,
        "port": port,
        "username": username,
        "version": data["version"] 
    }

    try:
        response = requests.post(
            f"{WORKER_API_URL}/api/start", 
            json=payload, 
            timeout=10 
        )
        if response.status_code == 200:
            data["is_running"] = True
            save_data()
            return True, "✅ Команда запуска отправлена Worker\\-сервису\\."
        else:
            error_text = response.json().get('error', response.text)
            logger.error(f"Worker START failed ({response.status_code}): {error_text}")
            escaped_error = escape_markdown(error_text[:100])
            
            return False, f"❌ Ошибка запуска Worker'а: статус {response.status_code} \\({escaped_error}\.\.\.\\)"
            
    except requests.exceptions.RequestException as e:
        logger.error(f"Ошибка при вызове Worker API (START): {e}")
        return False, f"❌ Ошибка соединения с Worker'ом\\. Проверьте, запущен ли Worker\\."


async def stop_worker_bot(chat_id):
    """Останавливает Mineflayer-бота через Worker API."""
    data = get_user_data(chat_id)
    chat_id_str = str(chat_id)
    
    if not data["is_running"]:
        return True, "Бот уже остановлен\\."

    try:
        response = requests.post(
            f"{WORKER_API_URL}/api/stop", 
            json={"chatId": chat_id_str}, 
            timeout=10
        )
        
        if response.status_code == 200:
            data["is_running"] = False
            save_data()
            return True, "⏹ Команда остановки отправлена Worker\\-сервису\\."
        
        else:
            error_text = response.json().get('error', response.text)
            logger.error(f"Worker STOP failed ({response.status_code}): {error_text}")
            data["is_running"] = False
            save_data()
            
            return False, (
                f"❌ Ошибка остановки Worker'а: статус {response.status_code}\\. "
                f"Локальный статус сброшен для возможности перезапуска\\."
            )
    
    except requests.exceptions.RequestException as e:
        logger.error(f"Ошибка при вызове Worker API (STOP): {e}")
        data["is_running"] = False
        save_data()
        return False, f"❌ Ошибка соединения с Worker'ом\\. Проверьте WORKER\\_API\\_URL\\."


# ----------------------------------------------------------------------
#                               HANDLERS
# ----------------------------------------------------------------------

async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Отображает главное меню."""
    if update.effective_chat:
        chat_id = update.effective_chat.id
    elif update.callback_query and update.callback_query.message:
        chat_id = update.callback_query.message.chat_id
    else:
        logger.error("Не удалось определить chat_id для start_command.")
        return
        
    data = get_user_data(chat_id)
    
    data["is_running"] = await get_worker_status(chat_id)
    save_data()
    
    # ЛОГИКА УПРАВЛЕНИЯ KICKSTAND УДАЛЕНА
    
    status_text = '🟢 Подключен' if data["is_running"] else '🔴 Отключен'
    notif_status = 'Включены \\(🔔\\)' if data["send_notifications"] else 'Выключены \\(🔕\\)' 
    
    escaped_host = escape_markdown(data["host"]) if data["host"] else 'Не задан'
    escaped_username = escape_markdown(data["username"])
    escaped_api_url = escape_markdown(WORKER_API_URL) 
    
    server_text = f"{escaped_host}:{data['port']}" if data["host"] else 'Не задан' 
    version_text = escape_markdown(data["version"])

    message_text = (
        f"⚙️ \\*Панель управления ботом\\*\n\n"
        f"Статус: \\*{status_text}\\*\n"
        f"Сервер: \\*{server_text}\\*\n"
        f"Версия: \\*{version_text}\\*\n"
        f"Имя бота: \\*{escaped_username}\\*\n"
        f"Уведомления: \\*{notif_status}\\*\n\n"
        f"\\_Worker API: {escaped_api_url}\\_"
    )
    
    reply_markup = get_main_menu_keyboard(data["username"], data["send_notifications"], data["is_running"])
    
    if update.callback_query and update.callback_query.message:
        try:
            await update.callback_query.edit_message_text(message_text, parse_mode='MarkdownV2', reply_markup=reply_markup)
        except Exception:
            # Отправка нового сообщения в случае ошибки редактирования
            await update.callback_query.message.reply_text(message_text, parse_mode='MarkdownV2', reply_markup=reply_markup)
    else:
        await update.message.reply_text(message_text, parse_mode='MarkdownV2', reply_markup=reply_markup)


async def button_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    await query.answer()
    chat_id = query.message.chat_id
    data = get_user_data(chat_id)
    
    action = query.data

    if action == "start_bot":
        if data["is_running"]:
            await query.message.reply_text("Бот уже запущен\\.", parse_mode='MarkdownV2')
            await start_command(update, context) 
            return
            
        if data["host"] is None or data["port"] is None:
            await query.message.reply_text("⚠️ Сначала задайте адрес сервера через **⚙️ Сменить сервер** или команду `/setserver`\\.", parse_mode='MarkdownV2')
            await start_command(update, context)
            return

        escaped_username = escape_markdown(data['username'])
        await query.edit_message_text(f"Запускаю Minecraft бота \\*{escaped_username}\\* через Worker\\.\\.\\.", parse_mode='MarkdownV2')
        
        success, message = await start_worker_bot(chat_id, data["host"], data["port"], data["username"])
        
        # ЛОГИКА ЗАПУСКА KICKSTAND УДАЛЕНА
            
        await query.message.reply_text(message, parse_mode='MarkdownV2')
        await start_command(update, context) 

    elif action == "stop_bot":
        if not data["is_running"]:
            await query.message.reply_text("Бот уже остановлен\\.", parse_mode='MarkdownV2')
            await start_command(update, context)
            return

        # ЛОГИКА ОСТАНОВКИ KICKSTAND УДАЛЕНА
        
        await query.edit_message_text("Отправляю команду на остановку Minecraft бота\\.\\.\\.")
        success, message = await stop_worker_bot(chat_id)
        
        await query.message.reply_text(message, parse_mode='MarkdownV2')
        await start_command(update, context) 

    elif action == "set_server_prompt":
        escaped_example = escape_markdown("test.aternos.me:17484")
        await query.edit_message_text(
            f'💬 Отправьте адрес сервера в формате: `/setserver домен:порт` \\(например: `/setserver {escaped_example}`\\)', 
            parse_mode='MarkdownV2',
            reply_markup=None
        )

    elif action == "set_version_prompt":
        escaped_example = escape_markdown("1.20.1")
        await query.edit_message_text(
            f'💬 Отправьте версию сервера в формате: `/setversion N.N.N` \\(например: `/setversion {escaped_example}`\\)', 
            parse_mode='MarkdownV2',
            reply_markup=None
        )

    elif action == "set_username_prompt":
        data["awaiting_username"] = True
        save_data()
        await query.edit_message_text(
            '💬 \\*Отправьте новое имя\\* для Minecraft бота\\. \\(Имя должно быть от 3 до 16 символов без пробелов\\)', 
            parse_mode='MarkdownV2',
            reply_markup=None
        )
        
    elif action == "send_command_prompt":
        if not data["is_running"]:
            await query.message.reply_text("❌ Бот не запущен, команды не могут быть отправлены\\.", parse_mode='MarkdownV2')
            await start_command(update, context)
            return
            
        data["awaiting_command"] = True
        save_data()
        await query.edit_message_text(
            '💬 \\*Отправьте команду\\* для выполнения в Minecraft чате \\(например, `/say Привет` или `/op ВашеИмя`\\)\\.', 
            parse_mode='MarkdownV2',
            reply_markup=None
        )

    elif action == "toggle_notifications":
        is_on = data.get("send_notifications", True)
        data["send_notifications"] = not is_on
        status = 'ВКЛЮЧЕНЫ \\(🔔\\)' if data["send_notifications"] else 'ВЫКЛЮЧЕНЫ \\(🔕\\)'
        save_data()
        
        await query.message.reply_text(f"✅ Уведомления успешно \\*{status}\\*", parse_mode='MarkdownV2')
        
        await start_command(update, context)

    elif action == "refresh_status":
        await query.edit_message_text("⏳ Проверяю статус Mineflayer бота на Worker Service\.\.\.", parse_mode='MarkdownV2', reply_markup=None)
        
        data["is_running"] = await get_worker_status(chat_id)
        
        # ЛОГИКА УПРАВЛЕНИЯ KICKSTAND УДАЛЕНА
            
        save_data()
        
        await start_command(update, context) 


async def setserver_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    chat_id = update.effective_chat.id
    data = get_user_data(chat_id)
    
    if not context.args:
        await update.message.reply_text("❌ Неверный формат\\. Используйте: `/setserver домен:порт`", parse_mode='MarkdownV2')
        await start_command(update, context)
        return

    full_address = context.args[0].strip()
    parts = full_address.split(':')
    
    if len(parts) == 2 and parts[1].isdigit():
        data["host"] = parts[0].strip()
        data["port"] = int(parts[1].strip())
        
        escaped_host = escape_markdown(data["host"])
        
        await update.message.reply_text(f"✅ Сервер установлен: \\*{escaped_host}:{data['port']}\\*\\.", parse_mode='MarkdownV2')
        
        if data["is_running"]:
            # ЛОГИКА ОСТАНОВКИ KICKSTAND УДАЛЕНА
            await stop_worker_bot(chat_id)
            await update.message.reply_text('🔄 Бот остановлен для применения новых настроек\\. Запустите его снова через /menu\\.', parse_mode='MarkdownV2')
        
        save_data()
        
        await start_command(update, context)
    else:
        await update.message.reply_text("❌ Неверный формат\\. Используйте: `/setserver домен:порт`", parse_mode='MarkdownV2')
        await start_command(update, context)


async def setversion_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Устанавливает версию Minecraft через команду."""
    chat_id = update.effective_chat.id
    data = get_user_data(chat_id)
    
    if not context.args:
        # Если аргументов нет, просим пользователя ввести версию
        escaped_example = escape_markdown("1.20.1")
        await update.message.reply_text(
            f"💬 Отправьте версию сервера в формате: `/setversion N.N.N` \\(например: `/setversion {escaped_example}`\\)", 
            parse_mode='MarkdownV2'
        )
        return

    new_version = context.args[0].strip()
    
    if not new_version:
        await update.message.reply_text("❌ Версия не может быть пустой\\.", parse_mode='MarkdownV2')
        return

    data["version"] = new_version
    
    escaped_version = escape_markdown(data["version"])
    
    await update.message.reply_text(f"✅ Версия Minecraft установлена: \\*{escaped_version}\\*\\.", parse_mode='MarkdownV2')
    
    if data["is_running"]:
        # ЛОГИКА ОСТАНОВКИ KICKSTAND УДАЛЕНА
        await stop_worker_bot(chat_id)
        await update.message.reply_text('🔄 Бот остановлен для применения новой версии\\. Запустите его снова через /menu\\.', parse_mode='MarkdownV2')
    
    save_data()
    
    await start_command(update, context)


async def text_message_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    chat_id = update.effective_chat.id
    text = update.message.text
    data = get_user_data(chat_id)
    
    if not text:
        return
        
    text = text.strip() 
    
    # Игнорируем команды Telegram, чтобы не мешать /start, /setserver и т.д.
    if text.startswith('/'):
        return
        
    # 1. --- Обработка ввода имени пользователя ---
    if data.get("awaiting_username"):
        new_username = text
        
        if len(new_username) > 16 or len(new_username) < 3 or ' ' in new_username:
            await update.message.reply_text('❌ Имя должно быть от 3 до 16 символов и не содержать пробелов\\. Попробуйте снова\\.', parse_mode='MarkdownV2')
            return
        
        data["username"] = new_username
        data["awaiting_username"] = False
        save_data()
        
        escaped_username = escape_markdown(data["username"])
        
        if data["is_running"]:
            # ЛОГИКА ОСТАНОВКИ KICKSTAND УДАЛЕНА
            await stop_worker_bot(chat_id)
            await update.message.reply_text(f"✅ Имя бота успешно изменено на \\*{escaped_username}\\*\\. Бот был остановлен\\. Запустите его снова через /menu\\.", parse_mode='MarkdownV2')
        else:
            await update.message.reply_text(f"✅ Имя бота успешно изменено на \\*{escaped_username}\\*\\.", parse_mode='MarkdownV2')

        await start_command(update, context)
        return

    # 2. --- Обработка ввода команды (после нажатия кнопки) ---
    if data.get("awaiting_command"):
        if not data["is_running"]:
            await update.message.reply_text("❌ Бот не запущен, команда не может быть отправлена\\. Запустите его через /menu\\.", parse_mode='MarkdownV2')
            data["awaiting_command"] = False
            save_data()
            await start_command(update, context)
            return

        command = text
        try:
            requests.post(f"{WORKER_API_URL}/api/command", json={"chatId": str(chat_id), "command": command}, timeout=5).raise_for_status()
            
            data["awaiting_command"] = False
            save_data()
            await update.message.reply_text(f"✅ Команда `{escape_markdown(command)}` отправлена боту\\.", parse_mode='MarkdownV2')
            await start_command(update, context)
            
        except requests.exceptions.RequestException as e:
            error_message = str(e)
            data["awaiting_command"] = False
            save_data()
            await update.message.reply_text(f"❌ Ошибка при отправке команды боту: `{escape_markdown(error_message)}`\\.", parse_mode='MarkdownV2')
            await start_command(update, context)
        
        return
            
    # 3. --- Общая пересылка сообщений (Чат) ---
        
    if data["is_running"]:
        try:
            # Пересылаем сообщение как команду для бота (для чата)
            requests.post(f"{WORKER_API_URL}/api/command", json={"chatId": str(chat_id), "command": text}, timeout=5).raise_for_status()
        except requests.exceptions.RequestException as e:
            logger.error(f"Ошибка при отправке команды чата боту: {e}")
    else:
        # Бот не запущен, а это не команда и не ожидаемый ввод
        await update.message.reply_text("🤖 Бот не запущен\\. Запустите его через /menu\\.", parse_mode='MarkdownV2')

# ----------------------------------------------------------------------
#                             ТОЧКА ВХОДА (POLLING)
# ----------------------------------------------------------------------

def main():
    """Основная функция запуска бота в режиме Polling."""
    global tg_app
    
    load_data()

    # ИНИЦИАЛИЗАЦИЯ JobQueue УДАЛЕНА
    tg_app = Application.builder().token(TELEGRAM_TOKEN).build()
    
    tg_app.add_handler(CommandHandler(["start", "menu"], start_command))
    tg_app.add_handler(CommandHandler("setserver", setserver_command))
    tg_app.add_handler(CommandHandler("setversion", setversion_command))
    tg_app.add_handler(CallbackQueryHandler(button_callback))
    
    # Обработчик текстовых сообщений, исключая команды Telegram
    tg_app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_message_handler))

    logger.info("Бот запущен в режиме Polling.")
    
    tg_app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == '__main__':
    main()
