
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const cron = require('node-cron');
const express = require('express');
const path = require('path');

// --- КОНФИГУРАЦИЯ ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const API_KEY = process.env.API_KEY; // Для Gemini (опционально в боте)
const LAT = 34.6593; // Limassol default
const LNG = 33.0038;
const RAIN_THRESHOLD = 0.5;

if (!BOT_TOKEN || !CHAT_ID) {
  console.warn('⚠️ ВНИМАНИЕ: Переменные BOT_TOKEN или CHAT_ID не установлены. Бот не запустится.');
}

const bot = new Telegraf(BOT_TOKEN);
let wasRaining = false;

// --- ЛОГИКА ПОГОДЫ ---
async function getWeather() {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LNG}&current=temperature_2m,precipitation,weather_code,wind_speed_10m&hourly=temperature_2m,precipitation,weather_code&timezone=auto`;
  const { data } = await axios.get(url);
  return data;
}

const isRain = (code, prec) => code >= 51 && prec >= RAIN_THRESHOLD;

async function checkWeatherTask() {
  try {
    const data = await getWeather();
    const current = data.current;
    const rainingNow = isRain(current.weather_code, current.precipitation);

    if (rainingNow && !wasRaining) {
      await bot.telegram.sendMessage(CHAT_ID, `🚨 СРОЧНО! Начался дождь (${current.precipitation} мм). Уберите вещи! 🧺🌧️`);
    } else if (!rainingNow && wasRaining) {
      await bot.telegram.sendMessage(CHAT_ID, "☀️ Дождь прекратился. Можно сушить вещи! ✅");
    }
    wasRaining = rainingNow;
  } catch (e) {
    console.error("Cron check failed:", e.message);
  }
}

// --- КОМАНДЫ БОТА ---
const mainMenu = Markup.keyboard([
  ['🌡️ Погода сейчас', '📅 Прогноз на день'],
  ['🌙 Прогноз на ночь', 'ℹ️ Помощь']
]).resize();

bot.start((ctx) => ctx.reply("🛡️ RainGuard v2.8 запущена! Я слежу за небом Limassol.", mainMenu));

bot.hears('🌡️ Погода сейчас', async (ctx) => {
  const data = await getWeather();
  const c = data.current;
  ctx.reply(`📍 Сейчас:\n🌡 ${c.temperature_2m}°C\n💧 Осадки: ${c.precipitation} мм\n💨 Ветер: ${c.wind_speed_10m} км/ч`);
});

bot.hears('📅 Прогноз на день', async (ctx) => {
  const data = await getWeather();
  const next12 = data.hourly.time.slice(0, 12);
  const rainHours = [];
  next12.forEach((time, i) => {
    if (isRain(data.hourly.weather_code[i], data.hourly.precipitation[i])) {
      rainHours.push(`${new Date(time).getHours()}:00`);
    }
  });
  ctx.reply(rainHours.length > 0 
    ? `🌧 Ожидается дождь в: ${rainHours.join(', ')}. Будьте внимательны!` 
    : "☀️ В ближайшие 12 часов дождя не ожидается. Стирайте смело!");
});

bot.hears('🌙 Прогноз на ночь', async (ctx) => {
  const data = await getWeather();
  const rainHours = [];
  data.hourly.time.slice(0, 24).forEach((time, i) => {
    const hour = new Date(time).getHours();
    if ((hour >= 22 || hour <= 7) && isRain(data.hourly.weather_code[i], data.hourly.precipitation[i])) {
      rainHours.push(`${hour}:00`);
    }
  });
  ctx.reply(rainHours.length > 0 
    ? `🌙 Ночью будет дождь в: ${rainHours.join(', ')}. Уберите вещи!` 
    : "✅ Ночь будет сухой. Можно оставлять вещи на улице.");
});

bot.hears('ℹ️ Помощь', (ctx) => ctx.reply("Я проверяю погоду каждые 15 минут. Если будет дождь > 0.5мм — я напишу."));

// Запуск задач и бота
if (BOT_TOKEN) {
  bot.launch();
  cron.schedule('*/15 * * * *', checkWeatherTask);
}

// --- ЭКСПРЕСС (ДЛЯ СИМУЛЯТОРА И RENDER) ---
const app = express();
const PORT = process.env.PORT || 3000;

// Отдаем статические файлы (симулятор)
app.use(express.static(__dirname));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
