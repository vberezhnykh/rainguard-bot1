
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const cron = require('node-cron');
const express = require('express');
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

// Log configuration status for debugging
console.log("🛠 Boot diagnostics:");
console.log("- BOT_TOKEN:", BOT_TOKEN ? "✅ OK" : "❌ MISSING");
console.log("- CHAT_ID:", CHAT_ID ? "✅ OK" : "❌ MISSING");
console.log("- OPENWEATHER_KEY:", OPENWEATHER_API_KEY ? "✅ OK" : "⚠️ MISSING (Using fallback)");
console.log("- GEMINI_KEY:", API_KEY ? "✅ OK" : "❌ MISSING");

if (!BOT_TOKEN) {
  console.error("FATAL: BOT_TOKEN is required to start.");
  process.exit(1);
}

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
      contents: "Exactly current weather in Limassol (temp Celsius, precipitation mm last hour)? Respond JSON ONLY: {\"temp\": 20, \"precip\": 0}",
      config: { 
        tools: [{ googleSearch: {} }],
        thinkingConfig: { thinkingBudget: 0 } 
      }
    });

    const jsonMatch = response.text?.match(/\{.*\}/s);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        current: {
          temp: parsed.temp ?? 20,
          precip: parsed.precip ?? 0,
          description: (parsed.precip > 0.1) ? 'Rain' : 'Clear'
        }
      };
    }
    throw new Error("Invalid Gemini response format");
  } catch (e) {
    console.error("Gemini Error:", e.message);
    if (JSON.stringify(e).includes('429')) geminiBlockedUntil = now + (15 * 60 * 1000);
    throw e;
  }
}

// --- WEATHER FETCHING ---
async function getWeather() {
  const now = Date.now();
  
  // 1. Fresh cache (15 mins)
  if (weatherCache && (now - lastFetchTime < 15 * 60 * 1000)) {
    return weatherCache;
  }

  // 2. Try OpenWeather API
  if (OPENWEATHER_API_KEY) {
    try {
      const url = `https://api.openweathermap.org/data/2.5/weather?lat=${LAT}&lon=${LNG}&appid=${OPENWEATHER_API_KEY.trim()}&units=metric`;
      const { data } = await axios.get(url, { timeout: 10000 });
      
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
      console.warn(`🛑 OpenWeather failed (${e.response?.status || e.message}). Trying Gemini.`);
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
      console.log("📦 Emergency: Using old cache.");
      return weatherCache;
    }
    throw new Error("All weather providers failed.");
  }
}

async function checkWeatherTask() {
  if (!BOT_TOKEN || !CHAT_ID) return;
  try {
    const data = await getWeather();
    const current = data.current;
    const rainingNow = current.precip >= RAIN_THRESHOLD;

    if (rainingNow && !wasRaining) {
      await bot.telegram.sendMessage(CHAT_ID, `🌧 Дождь! (${current.precip} мм). Снимай белье! 🧺`);
    } else if (!rainingNow && wasRaining) {
      await bot.telegram.sendMessage(CHAT_ID, "☀️ Прояснилось.");
    }
    wasRaining = rainingNow;
  } catch (e) {
    console.error("Task error:", e.message);
  }
}

// --- BOT INTERFACE ---
const mainMenu = Markup.keyboard([['🌡️ Погода сейчас', 'ℹ️ Помощь']]).resize();

bot.start((ctx) => ctx.reply("🛡️ RainGuard v3.1 активен.", mainMenu));

bot.hears('🌡️ Погода сейчас', async (ctx) => {
  try {
    const data = await getWeather();
    const c = data.current;
    ctx.reply(`📍 Лимассол:\n🌡 ${c.temp}°C\n💧 Осадки: ${c.precip} мм\n☁️ ${c.description}`);
  } catch (e) {
    ctx.reply("❌ Ошибка датчиков.");
  }
});

bot.hears('ℹ️ Помощь', (ctx) => ctx.reply("Мониторинг каждые 30 мин. Порог: 0.5мм осадков."));

// --- SERVER SETUP ---
const app = express();
app.get('/health', (req, res) => res.status(200).send('OK'));

if (RENDER_URL && BOT_TOKEN) {
  const webhookPath = `/bot${BOT_TOKEN}`;
  app.use(bot.webhookCallback(webhookPath));
  bot.telegram.setWebhook(`${RENDER_URL}${webhookPath}`)
    .then(() => console.log(`🚀 Webhook set: ${RENDER_URL}`))
    .catch(e => console.error("Webhook error:", e.message));
} else {
  bot.launch().then(() => console.log("🤖 Polling started"));
}

app.listen(process.env.PORT || 3000, () => {
  console.log("💻 Server ready.");
  cron.schedule('*/30 * * * *', checkWeatherTask);
});

// Safe Shutdown
const shutdown = (signal) => {
  console.log(`${signal} received. Cleaning up...`);
  try {
    // Only stop if running in polling mode, avoid crash in webhook mode
    if (!RENDER_URL) bot.stop(signal);
  } catch (e) {
    // Ignore "Bot is not running" error
  }
  process.exit(0);
};

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
