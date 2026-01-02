
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const cron = require('node-cron');
const express = require('express');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

// --- CONFIGURATION ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const API_KEY = process.env.API_KEY; // Gemini API Key
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY; 
const RENDER_URL = process.env.RENDER_EXTERNAL_URL; 
const LAT = 34.6593; 
const LNG = 33.0038;
const RAIN_THRESHOLD = 0.5;

// State management
let wasRaining = false;
let weatherCache = null;
let lastFetchTime = 0;
let geminiBlockedUntil = 0;

const bot = new Telegraf(BOT_TOKEN);

// --- GEMINI SEARCH FALLBACK ---
async function getWeatherViaGemini() {
  const now = Date.now();
  if (!API_KEY) throw new Error("API_KEY missing");
  if (now < geminiBlockedUntil) throw new Error("Gemini cooling down");

  console.log("🔄 Using Gemini fallback for weather...");
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: "Weather in Limassol (temp Celsius, precip mm last hour)? JSON ONLY: {\"temp\": 20, \"precip\": 0}",
      config: { tools: [{ googleSearch: {} }] }
    });

    const jsonMatch = response.text?.match(/\{.*\}/s);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        current: {
          temp: parsed.temp ?? 20,
          precip: parsed.precip ?? 0,
          description: parsed.precip > 0.1 ? 'Rain' : 'Clear'
        }
      };
    }
    throw new Error("Invalid Gemini response format");
  } catch (e) {
    if (JSON.stringify(e).includes('429')) geminiBlockedUntil = now + (10 * 60 * 1000);
    throw e;
  }
}

// --- WEATHER FETCHING VIA OPENWEATHER ---
async function getWeather() {
  const now = Date.now();
  
  // 1. Fresh cache (10 mins)
  if (weatherCache && (now - lastFetchTime < 10 * 60 * 1000)) {
    return weatherCache;
  }

  // 2. Try OpenWeather API
  if (OPENWEATHER_API_KEY) {
    try {
      const url = `https://api.openweathermap.org/data/2.5/weather?lat=${LAT}&lon=${LNG}&appid=${OPENWEATHER_API_KEY}&units=metric`;
      const { data } = await axios.get(url, { timeout: 8000 });
      
      const processedData = {
        current: {
          temp: data.main.temp,
          precip: data.rain ? (data.rain['1h'] || data.rain['3h'] / 3 || 0) : 0,
          description: data.weather[0].main
        }
      };
      
      weatherCache = processedData;
      lastFetchTime = now;
      return processedData;
    } catch (e) {
      console.warn("🛑 OpenWeather request failed, trying fallback.");
    }
  }

  // 3. Fallback: Gemini
  try {
    const geminiData = await getWeatherViaGemini();
    weatherCache = geminiData;
    lastFetchTime = now;
    return geminiData;
  } catch (e) {
    if (weatherCache) {
      console.log("📦 Returning stale cache as last resort.");
      return weatherCache;
    }
    throw new Error("No weather data available.");
  }
}

async function checkWeatherTask() {
  if (!BOT_TOKEN || !CHAT_ID) return;
  try {
    const data = await getWeather();
    const current = data.current;
    const rainingNow = current.precip >= RAIN_THRESHOLD;

    if (rainingNow && !wasRaining) {
      await bot.telegram.sendMessage(CHAT_ID, `🌧 Внимание! В Лимассоле дождь (${current.precip} мм). Пора спасать белье! 🧺`);
    } else if (!rainingNow && wasRaining) {
      await bot.telegram.sendMessage(CHAT_ID, "☀️ Дождь прекратился. Небо проясняется.");
    }
    wasRaining = rainingNow;
  } catch (e) {
    console.error("Task failed:", e.message);
  }
}

// --- BOT INTERFACE ---
const mainMenu = Markup.keyboard([['🌡️ Погода сейчас', 'ℹ️ Помощь']]).resize();

bot.start((ctx) => ctx.reply("🛡️ RainGuard v3.0 (OpenWeather Edition). Мониторинг запущен.", mainMenu));

bot.hears('🌡️ Погода сейчас', async (ctx) => {
  try {
    const data = await getWeather();
    const c = data.current;
    const isStale = (Date.now() - lastFetchTime) > 20 * 60 * 1000;
    ctx.reply(`📍 Лимассол:\n🌡 ${c.temp}°C\n💧 Осадки: ${c.precip} мм\n☁️ ${c.description}${isStale ? '\n⚠️ (Кэшированные данные)' : ''}`);
  } catch (e) {
    ctx.reply("❌ Ошибка получения данных. Попробуйте позже.");
  }
});

bot.hears('ℹ️ Помощь', (ctx) => ctx.reply("Бот RainGuard. Использует OpenWeather API + Gemini AI для надежности. Проверка каждые 30 минут."));

// --- SERVER SETUP ---
const app = express();
app.use(express.static(__dirname));
app.get('/health', (req, res) => res.status(200).send('OK'));

if (RENDER_URL && BOT_TOKEN) {
  const webhookPath = `/bot${BOT_TOKEN}`;
  app.use(bot.webhookCallback(webhookPath));
  bot.telegram.setWebhook(`${RENDER_URL}${webhookPath}`).catch(console.error);
} else if (BOT_TOKEN) {
  bot.launch().catch(console.error);
}

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running. Task scheduled.");
  cron.schedule('*/30 * * * *', checkWeatherTask);
});
