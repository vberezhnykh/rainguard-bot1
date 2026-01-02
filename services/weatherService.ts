
import { WeatherData } from '../types';
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

const getGeminiWeatherFallback = async (): Promise<{current: WeatherData, forecast: WeatherData[]}> => {
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: "What is the exact current weather in Limassol? Give me temperature and precipitation. Format as JSON: {\"temp\": 25, \"precip\": 0}",
    config: { tools: [{ googleSearch: {} }] }
  });

  const text = response.text || "";
  const jsonMatch = text.match(/\{.*\}/s);
  if (jsonMatch) {
    const data = JSON.parse(jsonMatch[0]);
    const current: WeatherData = {
      temp: data.temp,
      precipitation: data.precip,
      windSpeed: 10,
      description: data.precip > 0 ? 'Rainy' : 'Clear',
      timestamp: Date.now()
    };
    return { current, forecast: [] };
  }
  throw new Error("Gemini Fallback Failed");
};

export const fetchWeather = async (lat: number, lng: number): Promise<{current: WeatherData, forecast: WeatherData[]}> => {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,precipitation,wind_speed_10m&hourly=temperature_2m,precipitation,wind_speed_10m&timezone=auto`;
  
  try {
    const response = await fetch(url);
    if (response.status === 429) throw new Error("429");
    const data = await response.json();

    const current: WeatherData = {
      temp: data.current.temperature_2m,
      precipitation: data.current.precipitation,
      windSpeed: data.current.wind_speed_10m,
      description: data.current.precipitation > 0 ? 'Rainy' : 'Clear',
      timestamp: Date.now()
    };

    const forecast: WeatherData[] = data.hourly.time.map((time: string, index: number) => ({
      temp: data.hourly.temperature_2m[index],
      precipitation: data.hourly.precipitation[index],
      windSpeed: data.hourly.wind_speed_10m[index],
      description: data.hourly.precipitation[index] > 0 ? 'Rainy' : 'Clear',
      timestamp: new Date(time).getTime()
    }));

    return { current, forecast };
  } catch (err: any) {
    if (err.message === "429") {
      return await getGeminiWeatherFallback();
    }
    throw err;
  }
};
