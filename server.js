
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
const RENDER_URL = process.env.RENDER_EXTERNAL_URL; // Render дает это автоматически
const LAT = 34.6593; 
const LNG = 33.0038;
const RAIN_THRESHOLD = 0.5;

let wasRaining = false;
let weatherCache = null;
let lastFetchTime = 0;
let isIpBlocked = false;
let blockedUntil = 0;

const bot = new Telegraf(BOT_TOKEN);
const ai = API_KEY ? new GoogleGenAI({ apiKey: API_KEY }) : null;

// --- ФОЛБЭК ЧЕРЕЗ GEMINI SEARCH ---
async function getWeatherViaGemini() {
  if (!ai) throw new Error("No Gemini API Key provided in environment variables");
  
  console.log("🔄 Using Gemini Weather Search (API Fallback)...");
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: "What is the current weather in Limassol? Answer with current temperature in Celsius and precipitation in mm. Respond ONLY with a JSON object: {\"temp\": number, \"precip\": number}",
      config: {
        tools: [{ googleSearch: {} }]
      }
    });

    const text = response.text;
    const jsonMatch = text.match(/\{.*\}/s);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        current: {
          temperature_2m: parsed.temp || 20,
          precipitation: parsed.precip || 0,
          weather_code: (parsed.precip > 0.5) ? 61 : 0
        },
        hourly: { time: [], precipitation: [], weather_code: [] }
      };
    }
  } catch (e) {
    console.error("Gemini fallback failed completely:", e.message);
  }
  throw new Error("All weather providers failed");
}

// --- ОСНОВНАЯ ЛОГИКА ПОГОДЫ ---
async function getWeather() {
  const now = Date.now();
  
  // Если кэш свежий (30 мин), отдаем его
  if (weatherCache && (now - lastFetchTime < 30 * 60 * 1000)) {
    return weatherCache;
  }

  // Если мы знаем, что IP заблокирован, сразу идем в Gemini
  if (isIpBlocked && now < blockedUntil) {
    return await getWeatherViaGemini();
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LNG}&current=temperature_2m,precipitation,weather_code&hourly=temperature_2m,precipitation,weather_code&timezone=auto`;
    const { data } = await axios.get(url, { timeout: 8000 });
    
    isIpBlocked = false;
    weatherCache = data;
    lastFetchTime = now;
    return data;
  } catch (e) {
    if (e.response && e.response.status === 429) {
      console.warn("🛑 Open-Meteo 429: IP is rate-limited. Activating Gemini for 1 hour.");
      isIpBlocked = true;
      blockedUntil = now + (60 * 60 * 1000); // Блокируем запросы к Open-Meteo на час
      return await getWeatherViaGemini();
    }
    if (weatherCache) return weatherCache;
    throw e;
  }
}

async function checkWeatherTask() {
  if (!BOT_TOKEN || !CHAT_ID) return;
  try {
    const data = await getWeather();
    const current = data.current;
    const rainingNow = current.weather_code >= 51 || current.precipitation >= RAIN_THRESHOLD;

    if (rainingNow && !wasRaining) {
      await bot.telegram.sendMessage(CHAT_ID, `🚨 Внимание! В Лимассоле начался дождь (${current.precipitation} мм). Уберите вещи! 🧺`);
    } else if (!rainingNow && wasRaining) {
      await bot.telegram.sendMessage(CHAT_ID, "☀️ Дождь прекратился. Можно снова сушить вещи!");
    }
    wasRaining = rainingNow;
  } catch (e) {
    console.error("Cron check failed:", e.message);
  }
}

// --- ИНТЕРФЕЙС БОТА ---
const mainMenu = Markup.keyboard([
  ['🌡️ Погода сейчас', '📅 Прогноз на день'],
  ['🌙 Прогноз на ночь', 'ℹ️ Помощь']
]).resize();

bot.start((ctx) => ctx.reply("🛡️ RainGuard v2.9 активен.\nИспользую интеллектуальные каналы данных для обхода лимитов.", mainMenu));

bot.hears('🌡️ Погода сейчас', async (ctx) => {
  try {
    const data = await getWeather();
    const c = data.current;
    ctx.reply(`📍 Лимассол:\n🌡 ${c.temperature_2m}°C\n💧 Осадки: ${c.precipitation} мм\n${c.precipitation > 0.5 ? '🌧 Идет дождь!' : '☀️ Сухо'}`);
  } catch (e) {
    ctx.reply("⚠️ Не удалось получить данные. Попробуйте позже.");
  }
});

bot.hears('ℹ️ Помощь', (ctx) => ctx.reply("Я проверяю дождь каждые 30 минут.\nЕсли основной сервис погоды недоступен, я использую Google Search через Gemini AI."));

// --- СЕРВЕР И WEBHOOKS ---
const app = express();
app.use(express.static(__dirname));

// Health check для Render
app.get('/health', (req, res) => res.status(200).send('OK'));

// Webhook endpoint
if (RENDER_URL && BOT_TOKEN) {
  const webhookPath = `/bot${BOT_TOKEN}`;
  app.use(bot.webhookCallback(webhookPath));
  bot.telegram.setWebhook(`${RENDER_URL}${webhookPath}`)
    .then(() => console.log(`🚀 Webhook set to ${RENDER_URL}${webhookPath}`))
    .catch(err => console.error("Webhook error:", err));
} else if (BOT_TOKEN) {
  bot.launch(); // Локально используем Polling
}

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  // Запускаем проверки
  cron.schedule('5,35 * * * *', checkWeatherTask);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
