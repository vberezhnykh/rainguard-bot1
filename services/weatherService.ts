
import { WeatherData } from '../types';
import { GoogleGenAI } from "@google/genai";

let browserCache: {current: WeatherData, forecast: WeatherData[]} | null = null;
let lastFetch = 0;

const getGeminiWeatherFallback = async (): Promise<{current: WeatherData, forecast: WeatherData[]}> => {
  const apiKey = process.env.API_KEY || '';
  if (!apiKey) throw new Error("No API Key");
  
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: "Current weather in Limassol? JSON ONLY: {\"temp\": 25, \"precip\": 0, \"wind\": 10, \"desc\": \"Clear\"}",
    config: { tools: [{ googleSearch: {} }] }
  });

  const text = response.text || "";
  const jsonMatch = text.match(/\{.*\}/s);
  if (jsonMatch) {
    const data = JSON.parse(jsonMatch[0]);
    const current: WeatherData = {
      temp: data.temp,
      precipitation: data.precip,
      windSpeed: data.wind || 10,
      description: data.desc || (data.precip > 0 ? 'Rainy' : 'Clear'),
      timestamp: Date.now()
    };
    return { current, forecast: [] };
  }
  throw new Error("Gemini Fallback Failed");
};

export const fetchWeather = async (lat: number, lng: number): Promise<{current: WeatherData, forecast: WeatherData[]}> => {
  const now = Date.now();
  if (browserCache && (now - lastFetch < 10 * 60 * 1000)) {
    return browserCache;
  }

  // Using standard OpenWeather API (requires OPENWEATHER_API_KEY env var)
  const openWeatherKey = (process.env as any).OPENWEATHER_API_KEY;
  
  if (openWeatherKey) {
    try {
      const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${openWeatherKey}&units=metric`;
      const response = await fetch(url);
      if (!response.ok) throw new Error("OpenWeather fetch failed");
      const data = await response.json();

      const current: WeatherData = {
        temp: data.main.temp,
        precipitation: data.rain ? (data.rain['1h'] || data.rain['3h'] / 3 || 0) : 0,
        windSpeed: data.wind.speed * 3.6, // m/s to km/h
        description: data.weather[0].main,
        timestamp: Date.now()
      };

      // Forecast fetch
      const forecastUrl = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lng}&appid=${openWeatherKey}&units=metric`;
      const fResponse = await fetch(forecastUrl);
      const fData = await fResponse.json();
      
      const forecast: WeatherData[] = fData.list.map((item: any) => ({
        temp: item.main.temp,
        precipitation: item.rain ? (item.rain['3h'] / 3) : 0,
        windSpeed: item.wind.speed * 3.6,
        description: item.weather[0].main,
        timestamp: item.dt * 1000
      }));

      browserCache = { current, forecast };
      lastFetch = now;
      return browserCache;
    } catch (err) {
      console.warn("OpenWeather Error in simulator:", err);
    }
  }

  // Fallback to Gemini or Stale Cache
  try {
    const fallback = await getGeminiWeatherFallback();
    browserCache = { ...fallback, forecast: browserCache?.forecast || [] };
    lastFetch = now;
    return browserCache;
  } catch (fallbackErr) {
    if (browserCache) return browserCache;
    throw new Error("Weather services currently unavailable.");
  }
};
