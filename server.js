
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const cron = require('node-cron');
const express = require('express');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

// --- КОНФИГУРАЦИЯ ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const API_KEY = process.env.API_KEY;
const LAT = 34.6593; 
const LNG = 33.0038;
const RAIN_THRESHOLD = 0.5;

let wasRaining = false;
let weatherCache = null;
let lastFetchTime = 0;

const bot = new Telegraf(BOT_TOKEN);
const ai = API_KEY ? new GoogleGenAI({ apiKey: API_KEY }) : null;

// --- ФОЛБЭК ЧЕРЕЗ GEMINI SEARCH ---
async function getWeatherViaGemini() {
  if (!ai) throw new Error("No Gemini API Key");
  
  console.log("🔄 Attempting Gemini Weather Fallback...");
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: "Какая сейчас погода в Лимассоле (температура и осадки в мм)? Ответь строго в формате JSON: {\"temp\": 20, \"precip\": 0.5}",
    config: {
      tools: [{ googleSearch: {} }]
    }
  });

  try {
    // Извлекаем JSON из текста Gemini
    const text = response.text;
    const jsonMatch = text.match(/\{.*\}/s);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        current: {
          temperature_2m: parsed.temp || 20,
          precipitation: parsed.precip || 0,
          weather_code: (parsed.precip > 0) ? 61 : 0
        },
        hourly: { time: [], precipitation: [], weather_code: [] } // Для фолбэка не критично
      };
    }
  } catch (e) {
    console.error("Gemini parse error:", e);
  }
  throw new Error("Gemini fallback failed");
}

// --- ЛОГИКА ПОГОДЫ ---
async function getWeather() {
  const now = Date.now();
  if (weatherCache && (now - lastFetchTime < 30 * 60 * 1000)) {
    return weatherCache;
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LNG}&current=temperature_2m,precipitation,weather_code&hourly=temperature_2m,precipitation,weather_code&timezone=auto`;
    const { data } = await axios.get(url, { timeout: 8000 });
    weatherCache = data;
    lastFetchTime = now;
    return data;
  } catch (e) {
    if (e.response && e.response.status === 429) {
      console.warn("⚠️ IP Blocked. Switching to Gemini Search...");
      try {
        const fallbackData = await getWeatherViaGemini();
        weatherCache = fallbackData;
        lastFetchTime = now;
        return fallbackData;
      } catch (geminiErr) {
        console.error("Both providers failed.");
      }
    }
    if (weatherCache) return weatherCache;
    throw e;
  }
}

const isRain = (code, prec) => code >= 51 || prec >= RAIN_THRESHOLD;

async function checkWeatherTask() {
  if (!BOT_TOKEN || !CHAT_ID) return;
  try {
    const data = await getWeather();
    const current = data.current;
    const rainingNow = isRain(current.weather_code, current.precipitation);

    if (rainingNow && !wasRaining) {
      await bot.telegram.sendMessage(CHAT_ID, `🚨 СРОЧНО! В Лимассоле дождь (${current.precipitation} мм). Уберите вещи! 🧺`);
    } else if (!rainingNow && wasRaining) {
      await bot.telegram.sendMessage(CHAT_ID, "☀️ Дождь прекратился. Можно сушить вещи!");
    }
    wasRaining = rainingNow;
  } catch (e) {
    console.error("Task failed:", e.message);
  }
}

// --- КОМАНДЫ ---
const mainMenu = Markup.keyboard([
  ['🌡️ Погода сейчас', '📅 Прогноз на день'],
  ['🌙 Прогноз на ночь', 'ℹ️ Помощь']
]).resize();

bot.start((ctx) => ctx.reply("🛡️ RainGuard v2.8+ запущен. Я использую резервные каналы связи, если основной API перегружен.", mainMenu));

bot.hears('🌡️ Погода сейчас', async (ctx) => {
  try {
    const data = await getWeather();
    const c = data.current;
    ctx.reply(`📍 Сейчас (Limassol):\n🌡 ${c.temperature_2m}°C\n💧 Осадки: ${c.precipitation} мм`);
  } catch (e) {
    ctx.reply("⚠️ Ошибка: все погодные сервисы перегружены. Попробуйте через 30 минут.");
  }
});

bot.hears('📅 Прогноз на день', async (ctx) => {
  try {
    const data = await getWeather();
    if (!data.hourly.time.length) return ctx.reply("⚠️ Детальный прогноз на день сейчас недоступен.");
    const rainHours = [];
    data.hourly.time.slice(0, 12).forEach((time, i) => {
      if (isRain(data.hourly.weather_code[i], data.hourly.precipitation[i])) {
        rainHours.push(`${new Date(time).getHours()}:00`);
      }
    });
    ctx.reply(rainHours.length > 0 ? `🌧 Дождь в: ${rainHours.join(', ')}.` : "☀️ Ближайшие 12 часов будет сухо.");
  } catch (e) { ctx.reply("⚠️ Ошибка прогноза."); }
});

bot.hears('🌙 Прогноз на ночь', async (ctx) => {
  try {
    const data = await getWeather();
    if (!data.hourly.time.length) return ctx.reply("⚠️ Прогноз на ночь сейчас недоступен.");
    const rainHours = [];
    data.hourly.time.slice(0, 24).forEach((time, i) => {
      const hour = new Date(time).getHours();
      if ((hour >= 22 || hour <= 7) && isRain(data.hourly.weather_code[i], data.hourly.precipitation[i])) {
        rainHours.push(`${hour}:00`);
      }
    });
    ctx.reply(rainHours.length > 0 ? `🌙 Ночью дождь: ${rainHours.join(', ')}.` : "✅ Ночь будет сухой.");
  } catch (e) { ctx.reply("⚠️ Ошибка прогноза."); }
});

bot.hears('ℹ️ Помощь', (ctx) => ctx.reply("Я проверяю погоду раз в 30 минут. Использую основной API и резервный поиск Gemini."));

if (BOT_TOKEN) {
  bot.launch().catch(err => console.error("Launch error:", err));
  cron.schedule('1,31 * * * *', checkWeatherTask); // Проверка в 1-ю и 31-ю минуты часа
}

const app = express();
app.use(express.static(__dirname));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(process.env.PORT || 3000, () => console.log("Web server online"));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
