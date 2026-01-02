
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

if (!BOT_TOKEN) {
  console.error("FATAL: BOT_TOKEN is missing.");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// --- AI CORE ---
async function askGemini(prompt, weatherData = null) {
  if (!API_KEY) return null; // Fallback to templates if no key
  
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const context = weatherData 
    ? `Данные: Темп ${weatherData.temp}°C, Осадки ${weatherData.precip}мм, Описание: ${weatherData.description}.`
    : "";

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ parts: [{ text: `${context}\n\n${prompt}` }] }],
      config: {
        systemInstruction: "Ты — RainGuard, заботливый бот-помощник. Твоя цель — следить за погодой в Лимассоле, чтобы белье пользователя не намокло. Пиши кратко, дружелюбно, используй эмодзи. Не используй внешний поиск Google.",
        temperature: 0.8,
      },
    });
    return response.text;
  } catch (e) {
    console.error("Gemini Error:", e.message);
    return null;
  }
}

// --- WEATHER CORE ---
let weatherCache = null;
let lastFetchTime = 0;

async function fetchFromOpenWeather(type = 'weather') {
  if (!OPENWEATHER_API_KEY) throw new Error("OPENWEATHER_API_KEY is missing");
  const key = OPENWEATHER_API_KEY.trim();
  const url = `https://api.openweathermap.org/data/2.5/${type}?lat=${LAT}&lon=${LNG}&appid=${key}&units=metric&lang=ru`;
  
  try {
    const { data } = await axios.get(url, { timeout: 8000 });
    return data;
  } catch (e) {
    throw new Error(`Weather API error: ${e.message}`);
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
  } catch (e) {
    if (weatherCache) return weatherCache;
    throw e;
  }
}

// --- BOT LOGIC ---
const mainMenu = Markup.keyboard([
  ['🌡️ Погода сейчас', '📅 Прогноз на день'],
  ['🌙 Прогноз на ночь', 'ℹ️ Помощь']
]).resize();

bot.start(async (ctx) => {
  const welcome = await askGemini("Поприветствуй пользователя. Скажи, что ты RainGuard v4.1 и будешь следить за его бельем в Лимассоле.") || "Привет! Я RainGuard v4.1. Я слежу за погодой в Лимассоле.";
  ctx.reply(welcome, mainMenu);
});

bot.hears('🌡️ Погода сейчас', async (ctx) => {
  try {
    const c = await getFullWeather();
    const aiText = await askGemini("Расскажи о текущей погоде. Можно ли сейчас сушить белье?", c);
    ctx.reply(aiText || `🌡 ${c.temp}°C, Осадки: ${c.precip}мм. ${c.description}`);
  } catch (e) {
    ctx.reply("Ошибка получения данных. Проверьте OPENWEATHER_API_KEY.");
  }
});

bot.hears('📅 Прогноз на день', async (ctx) => {
  try {
    const data = await fetchFromOpenWeather('forecast');
    const rainPoints = data.list.slice(0, 4).filter(i => i.rain && (i.rain['3h'] > 0.5));
    const isRainSoon = rainPoints.length > 0;
    
    const prompt = isRainSoon 
      ? "В ближайшие 12 часов будет дождь. Предупреди пользователя, назови время (если можешь из контекста) и скажи не стирать."
      : "В ближайшие 12 часов дождя не будет. Скажи, что день отличный для стирки!";
    
    const aiText = await askGemini(prompt, { description: isRainSoon ? "Ожидается дождь" : "Сухо" });
    ctx.reply(aiText || (isRainSoon ? "Будет дождь!" : "Будет сухо!"));
  } catch (e) {
    ctx.reply("Ошибка прогноза.");
  }
});

bot.hears('🌙 Прогноз на ночь', async (ctx) => {
  try {
    const data = await fetchFromOpenWeather('forecast');
    const nightRain = data.list.slice(0, 8).some(i => {
      const h = new Date(i.dt * 1000).getHours();
      return (h >= 21 || h <= 6) && i.rain && (i.rain['3h'] > 0.5);
    });
    
    const aiText = await askGemini(nightRain ? "Ночью будет дождь. Предупреди!" : "Ночь будет сухой. Успокой пользователя.");
    ctx.reply(aiText || "Прогноз готов.");
  } catch (e) {
    ctx.reply("Ошибка.");
  }
});

bot.hears('ℹ️ Помощь', async (ctx) => {
  const helpText = await askGemini("Объясни кратко, что ты делаешь: проверяешь погоду каждые 30 мин и алармишь при дожде > 0.5мм.");
  ctx.reply(helpText || "Я слежу за дождем!");
});

// --- TASK & SERVER ---
let wasRaining = false;
async function checkWeatherTask() {
  if (!CHAT_ID) return;
  try {
    const c = await getFullWeather();
    const isRaining = c.precip >= RAIN_THRESHOLD;
    if (isRaining && !wasRaining) {
      const alertText = await askGemini("СРОЧНО! Начался дождь! Напиши очень короткий и тревожный алерт, чтобы пользователь бежал снимать белье!", c);
      await bot.telegram.sendMessage(CHAT_ID, alertText || `‼️ ДОЖДЬ! Снимай белье!`);
    }
    wasRaining = isRaining;
  } catch (e) { console.error(e.message); }
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
  console.log("Server running with Gemini Logic.");
  cron.schedule('*/30 * * * *', checkWeatherTask);
});
