
import { WeatherData } from '../types';

export const fetchWeather = async (lat: number, lng: number): Promise<{current: WeatherData, forecast: WeatherData[]}> => {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,precipitation,wind_speed_10m&hourly=temperature_2m,precipitation,wind_speed_10m&timezone=auto`;
  
  const response = await fetch(url);
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
};
