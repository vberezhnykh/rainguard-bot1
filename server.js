
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const cron = require('node-cron');
const express = require('express');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

// --- CONFIGURATION ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const API_KEY = process.env.API_KEY;
const RENDER_URL = process.env.RENDER_EXTERNAL_URL; 
const LAT = 34.6593; 
const LNG = 33.0038;
const RAIN_THRESHOLD = 0.5;

// State management
let wasRaining = false;
let weatherCache = null;
let lastFetchTime = 0;
let isIpBlocked = false;
let blockedUntil = 0;
let geminiBlockedUntil = 0;

const bot = new Telegraf(BOT_TOKEN);

// --- GEMINI FALLBACK WITH QUOTA MANAGEMENT ---
async function getWeatherViaGemini() {
  const now = Date.now();
  if (!API_KEY) throw new Error("API_KEY is missing");
  if (now < geminiBlockedUntil) {
    console.log("⏳ Gemini is in cooldown, skipping...");
    throw new Error("Gemini Cooldown");
  }

  console.log("🔄 Requesting weather via Gemini Search...");
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: "What is the current temperature and precipitation (mm) in Limassol, Cyprus? Return ONLY a JSON: {\"temp\": 20, \"precip\": 0}",
      config: { tools: [{ googleSearch: {} }] }
    });

    const text = response.text || "";
    const jsonMatch = text.match(/\{.*\}/s);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        current: {
          temperature_2m: parsed.temp ?? 20,
          precipitation: parsed.precip ?? 0,
          weather_code: (parsed.precip > 0.5) ? 61 : 0
        },
        hourly: { time: [], precipitation: [], weather_code: [] }
      };
    }
    throw new Error("No JSON in Gemini response");
  } catch (e) {
    const errorStr = JSON.stringify(e);
    if (errorStr.includes('429') || errorStr.includes('RESOURCE_EXHAUSTED')) {
      console.error("🛑 Gemini Quota Exhausted. Cooling down for 15m.");
      geminiBlockedUntil = now + (15 * 60 * 1000);
    }
    throw e;
  }
}

// --- RESILIENT WEATHER FETCHING ---
async function getWeather() {
  const now = Date.now();
  
  // 1. Return fresh cache if available (within 20 mins)
  if (weatherCache && (now - lastFetchTime < 20 * 60 * 1000)) {
    return weatherCache;
  }

  // 2. Try Open-Meteo if not explicitly blocked
  if (!isIpBlocked || now > blockedUntil) {
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LNG}&current=temperature_2m,precipitation,weather_code&hourly=temperature_2m,precipitation,weather_code&timezone=auto`;
      const { data } = await axios.get(url, { timeout: 10000 });
      
      isIpBlocked = false;
      weatherCache = data;
      lastFetchTime = now;
      return data;
    } catch (e) {
      if (e.response && e.response.status === 429) {
        console.warn("🛑 Open-Meteo blocked (429).");
        isIpBlocked = true;
        blockedUntil = now + (60 * 60 * 1000);
      }
    }
  }

  // 3. Fallback to Gemini
  try {
    const geminiData = await getWeatherViaGemini();
    weatherCache = geminiData;
    lastFetchTime = now;
    return geminiData;
  } catch (e) {
    console.error("⚠️ All APIs failed or exhausted.");
    // 4. SUPREME FALLBACK: If everything fails, return the last known good data (even if old)
    if (weatherCache) {
      console.log("📦 Returning stale cache as last resort.");
      return weatherCache;
    }
    throw new Error("No weather data available at all.");
  }
}

async function checkWeatherTask() {
  if (!BOT_TOKEN || !CHAT_ID) return;
  try {
    const data = await getWeather();
    const current = data.current;
    const rainingNow = current.weather_code >= 51 || current.precipitation >= RAIN_THRESHOLD;

    if (rainingNow && !wasRaining) {
      await bot.telegram.sendMessage(CHAT_ID, `🚨 СРОЧНО! В Лимассоле дождь (${current.precipitation} мм). Уберите вещи! 🧺`);
    } else if (!rainingNow && wasRaining) {
      await bot.telegram.sendMessage(CHAT_ID, "☀️ Дождь прекратился. Можно сушить вещи!");
    }
    wasRaining = rainingNow;
  } catch (e) {
    console.error("Task error:", e.message);
  }
}

// --- BOT LOGIC ---
const mainMenu = Markup.keyboard([
  ['🌡️ Погода сейчас', '📅 Прогноз на день'],
  ['🌙 Прогноз на ночь', 'ℹ️ Помощь']
]).resize();

bot.start((ctx) => ctx.reply("🛡️ RainGuard v2.9.2 активен. Я буду использовать кэш, если лимиты API будут превышены.", mainMenu));

bot.hears('🌡️ Погода сейчас', async (ctx) => {
  try {
    const data = await getWeather();
    const c = data.current;
    const minutesAgo = Math.floor((Date.now() - lastFetchTime) / 60000);
    const statusNote = minutesAgo > 30 ? `\n⚠️ (Данные получены ${minutesAgo} мин. назад, лимиты API превышены)` : "";
    
    ctx.reply(`📍 Лимассол:\n🌡 ${c.temperature_2m}°C\n💧 Осадки: ${c.precipitation} мм${statusNote}`);
  } catch (e) {
    ctx.reply("❌ Извините, сейчас невозможно получить данные даже через резервные каналы. Попробуйте через 15 минут.");
  }
});

bot.hears('ℹ️ Помощь', (ctx) => ctx.reply("Бот RainGuard. Проверка дождя каждые 30 минут. При сбоях API используется кэширование."));

// --- WEB SERVER & STARTUP ---
const app = express();
app.use(express.static(__dirname));
app.get('/health', (req, res) => res.status(200).send('OK'));

const PORT = process.env.PORT || 3000;

if (RENDER_URL && BOT_TOKEN) {
  // WEBHOOK MODE (For Production/Render)
  const webhookPath = `/bot${BOT_TOKEN}`;
  app.use(bot.webhookCallback(webhookPath));
  bot.telegram.setWebhook(`${RENDER_URL}${webhookPath}`)
    .then(() => console.log(`🚀 Webhook set: ${RENDER_URL}`))
    .catch(err => console.error("Webhook error:", err));
} else if (BOT_TOKEN) {
  // POLLING MODE (For local dev only)
  console.log("⚡ Starting in POLLING mode...");
  bot.launch().catch(err => console.error("Polling error:", err));
}

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => {
  console.log(`Server online on port ${PORT}`);
  cron.schedule('5,35 * * * *', checkWeatherTask);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
