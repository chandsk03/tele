const TelegramBot = require("node-telegram-bot-api");

const BOT_TOKEN = "8103505258:AAHQoLsJdBLmo4JSkAT0REY0KGM8uQP6fYY"; // Replace with your bot token
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Handle /start command
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "Welcome to the Fake Crypto Mining Bot! Click the button below to start mining.", {
        reply_markup: {
            inline_keyboard: [
                [{ text: "Start Mining", web_app: { url: "https://ticornx.site" } }],
            ],
        },
    });
});

// Handle any message
bot.on("message", (msg) => {
    console.log(`Message from ${msg.chat.id}: ${msg.text}`);
});

console.log("Bot is running...");
