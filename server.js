
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const cron = require('node-cron');
const express = require('express');
const { GoogleGenAI } = require('@google/genai');

// --- CONFIGURATION ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const API_KEY = process.env.API_KEY; 
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY; 
const RENDER_URL = process.env.RENDER_EXTERNAL_URL; 
const LAT = 34.6593; 
const LNG = 33.0038;
const RAIN_THRESHOLD = 0.5;

let wasRaining = false;
let weatherCache = null;
let lastFetchTime = 0;

if (!BOT_TOKEN) {
  console.error("FATAL: BOT_TOKEN is missing.");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// --- WEATHER CORE ---
async function fetchFromOpenWeather(type = 'weather') {
  if (!OPENWEATHER_API_KEY) throw new Error("Ключ OpenWeather не настроен в Render");
  const key = OPENWEATHER_API_KEY.trim();
  const url = `https://api.openweathermap.org/data/2.5/${type}?lat=${LAT}&lon=${LNG}&appid=${key}&units=metric&lang=ru`;
  
  try {
    const { data } = await axios.get(url, { timeout: 8000 });
    return data;
  } catch (e) {
    if (e.response?.status === 401) throw new Error("Ключ OpenWeather еще не активирован (нужно подождать 1-2 часа) или не верен.");
    if (e.response?.status === 429) throw new Error("Лимит запросов OpenWeather исчерпан.");
    throw new Error(`OpenWeather Error: ${e.message}`);
  }
}

async function getWeatherViaGemini() {
  if (!API_KEY) throw new Error("API_KEY (Gemini) не настроен");
  console.log("🔄 Fallback to Gemini Search...");
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: "Exactly current weather in Limassol (temp Celsius, precipitation mm last hour)? JSON: {\"temp\": 20, \"precip\": 0, \"desc\": \"Clear\"}",
      config: { tools: [{ googleSearch: {} }] }
    });

    const jsonMatch = response.text?.match(/\{.*\}/s);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        temp: parsed.temp,
        precip: parsed.precip || 0,
        description: parsed.desc || "Данные поиска"
      };
    }
    throw new Error("Gemini returned non-JSON format");
  } catch (e) {
    throw new Error(`Gemini Error: ${e.message}`);
  }
}

async function getFullWeather() {
  const now = Date.now();
  if (weatherCache && (now - lastFetchTime < 10 * 60 * 1000)) return weatherCache;

  try {
    const data = await fetchFromOpenWeather('weather');
    const result = {
      temp: data.main.temp,
      precip: data.rain ? (data.rain['1h'] || data.rain['3h'] / 3 || 0) : 0,
      description: data.weather[0].description
    };
    weatherCache = result;
    lastFetchTime = now;
    return result;
  } catch (owError) {
    console.warn(owError.message);
    try {
      const geminiData = await getWeatherViaGemini();
      weatherCache = geminiData;
      lastFetchTime = now;
      return geminiData;
    } catch (gemError) {
      throw new Error(`Все методы провалены.\n1. ${owError.message}\n2. ${gemError.message}`);
    }
  }
}

// --- BOT LOGIC ---
const mainMenu = Markup.keyboard([
  ['🌡️ Погода сейчас', '📅 Прогноз на день'],
  ['🌙 Прогноз на ночь', 'ℹ️ Помощь']
]).resize();

bot.start((ctx) => ctx.reply("🛡️ RainGuard v3.2 готов к работе в Лимассоле.", mainMenu));

bot.hears('🌡️ Погода сейчас', async (ctx) => {
  try {
    const c = await getFullWeather();
    ctx.reply(`📍 Лимассол:\n🌡 ${c.temp}°C\n💧 Осадки: ${c.precip} мм\n☁️ ${c.description}`);
  } catch (e) {
    ctx.reply(`❌ Ошибка:\n${e.message}`);
  }
});

bot.hears('📅 Прогноз на день', async (ctx) => {
  try {
    const data = await fetchFromOpenWeather('forecast');
    const today = data.list.slice(0, 8); // Ближайшие 24 часа
    const rainPoints = today.filter(i => i.rain && (i.rain['3h'] > 0.5));
    
    if (rainPoints.length > 0) {
      const times = rainPoints.map(i => new Date(i.dt * 1000).getHours() + ":00").join(', ');
      ctx.reply(`⚠️ В ближайшие 24ч ожидается дождь в: ${times}. Лучше не стирать! 🧺`);
    } else {
      ctx.reply("☀️ В ближайшие 24 часа дождя не ожидается. Стирать можно! ✅");
    }
  } catch (e) {
    ctx.reply(`❌ Ошибка прогноза:\n${e.message}`);
  }
});

bot.hears('🌙 Прогноз на ночь', async (ctx) => {
  try {
    const data = await fetchFromOpenWeather('forecast');
    const night = data.list.slice(0, 8).filter(i => {
      const hour = new Date(i.dt * 1000).getHours();
      return hour >= 21 || hour <= 6;
    });
    const rainPoints = night.filter(i => i.rain && (i.rain['3h'] > 0.5));
    
    if (rainPoints.length > 0) {
      ctx.reply("🌧️ Ночью возможен дождь. Не оставляйте белье на улице!");
    } else {
      ctx.reply("🌙 Ночь обещает быть сухой.");
    }
  } catch (e) {
    ctx.reply(`❌ Ошибка:\n${e.message}`);
  }
});

bot.hears('ℹ️ Помощь', (ctx) => ctx.reply("Бот RainGuard. Мониторинг каждые 30 мин. Порог аларма: 0.5мм."));

// --- TASK & SERVER ---
async function checkWeatherTask() {
  if (!CHAT_ID) return;
  try {
    const c = await getFullWeather();
    const rainingNow = c.precip >= RAIN_THRESHOLD;
    if (rainingNow && !wasRaining) {
      await bot.telegram.sendMessage(CHAT_ID, `🌧 Начался дождь (${c.precip} мм)! Снимай белье! 🧺`);
    }
    wasRaining = rainingNow;
  } catch (e) { console.error("Cron error:", e.message); }
}

const app = express();
app.get('/health', (req, res) => res.status(200).send('OK'));

if (RENDER_URL) {
  app.use(bot.webhookCallback(`/bot${BOT_TOKEN}`));
  bot.telegram.setWebhook(`${RENDER_URL}/bot${BOT_TOKEN}`).catch(console.error);
} else {
  bot.launch();
}

app.listen(process.env.PORT || 3000, () => {
  console.log("Server live.");
  cron.schedule('*/30 * * * *', checkWeatherTask);
});
