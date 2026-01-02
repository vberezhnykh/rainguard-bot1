
import { WeatherData } from '../types';

let browserCache: {current: WeatherData, forecast: WeatherData[]} | null = null;
let lastFetch = 0;

export const fetchWeather = async (lat: number, lng: number): Promise<{current: WeatherData, forecast: WeatherData[]}> => {
  const now = Date.now();
  if (browserCache && (now - lastFetch < 10 * 60 * 1000)) {
    return browserCache;
  }

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
        windSpeed: data.wind.speed * 3.6,
        description: data.weather[0].main,
        timestamp: Date.now()
      };

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
      if (browserCache) return browserCache;
      throw new Error("Не удалось получить данные от OpenWeather.");
    }
  }

  throw new Error("OPENWEATHER_API_KEY не задан.");
};
