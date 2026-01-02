
import { GoogleGenAI } from "@google/genai";
import { WeatherData } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const generateBotResponse = async (
  context: string,
  weatherData: WeatherData,
  isUrgent: boolean = false
): Promise<string> => {
  const prompt = isUrgent 
    ? `URGENT ALERT: Rain is expected in exactly 15 minutes! The user has laundry outside. Write a very short, urgent warning in Russian for a Telegram bot. Use emojis like 🌧️🧺.`
    : `CONTEXT: ${context}. Current Weather: Temp ${weatherData.temp}°C, Precipitation ${weatherData.precipitation}mm, Wind ${weatherData.windSpeed}km/h. 
       If this is a 12h forecast check, mention if rain is coming. Write a friendly, helpful message in Russian for a Telegram bot. Use emojis.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        systemInstruction: "You are 'RainGuard Bot', a helpful assistant that monitors weather specifically to help users protect their laundry and outdoor belongings. Your tone is alert but friendly. Speak Russian.",
        temperature: 0.7,
      },
    });
    
    return response.text || "Ошибка при генерации сообщения.";
  } catch (error) {
    console.error("Gemini Text Error:", error);
    return "Простите, не удалось получить прогноз сейчас.";
  }
};

export const generateBotIcon = async (): Promise<string | null> => {
  const prompt = "Professional high-quality profile picture for a Telegram bot named 'RainGuard'. A cute, modern 3D robot character with a digital happy face holding a bright blue umbrella over a clothesline with colorful clothes. Soft 3D render style, vibrant colors, clean white background, studio lighting, high resolution, minimalist and friendly design.";
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: { parts: [{ text: prompt }] },
      config: {
        imageConfig: {
          aspectRatio: "1:1"
        }
      }
    });

    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    return null;
  } catch (error) {
    console.error("Gemini Image Error:", error);
    return null;
  }
};
