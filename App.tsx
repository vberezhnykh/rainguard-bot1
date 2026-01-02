
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { TelegramMockup } from './components/TelegramMockup';
import { fetchWeather } from './services/weatherService';
import { generateBotResponse } from './services/geminiService';
import { BotMessage, WeatherData, LocationState } from './types';
import { MapPin } from 'lucide-react';

const App: React.FC = () => {
  const [messages, setMessages] = useState<BotMessage[]>([]);
  const [location, setLocation] = useState<LocationState>({ 
    lat: 34.6593, 
    lng: 33.0038, 
    address: 'Andrea Achillidi 10a, Zakaki, Limassol' 
  });
  
  const wasRainingRef = useRef(false);
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    const initialMsg: BotMessage = {
      id: '1',
      sender: 'bot',
      text: `Привет! Я RainGuard Bot v2.8 🛡️\nЯ слежу за погодой в Лимассоле.\n\nИспользуй кнопки ниже!`,
      timestamp: new Date()
    };
    setMessages([initialMsg]);
    setIsInitializing(false);
  }, []);

  const addBotMessage = (text: string, type?: BotMessage['type']) => {
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      sender: 'bot',
      text,
      timestamp: new Date(),
      type
    }]);
  };

  const checkWeatherLogic = useCallback(async (isManual: boolean = false) => {
    try {
      const { current } = await fetchWeather(location.lat, location.lng);
      const isRainingNow = current.precipitation > 0.5;

      if (!isManual) {
        if (isRainingNow && !wasRainingRef.current) {
          const msg = await generateBotResponse(`СРОЧНО: Начался дождь (${current.precipitation} мм)!`, current, true);
          addBotMessage(msg, 'urgent');
        } else if (!isRainingNow && wasRainingRef.current) {
          addBotMessage("☀️ Дождь прекратился! Можно сушить вещи. 🧺", 'forecast');
        }
        wasRainingRef.current = isRainingNow;
      }
    } catch (err) {
      console.warn("Weather simulator sync skipped (likely rate limit)");
    }
  }, [location.lat, location.lng]);

  useEffect(() => {
    checkWeatherLogic();
    // Увеличили интервал до 15 минут для симулятора, чтобы не спамить API с Render IP
    const interval = setInterval(() => checkWeatherLogic(), 900000);
    return () => clearInterval(interval);
  }, [checkWeatherLogic]);

  const handleUserMessage = async (text: string) => {
    setMessages(prev => [...prev, { id: Date.now().toString(), sender: 'user', text, timestamp: new Date() }]);
    
    try {
      const { current, forecast: hourly } = await fetchWeather(location.lat, location.lng);
      
      if (text === '🌡️ Погода сейчас') {
        const response = await generateBotResponse(`Запрос текущей погоды`, current);
        addBotMessage(response);
      } else if (text === '🌙 Прогноз на ночь') {
        const tonightHours = hourly.filter(h => {
          const hour = new Date(h.timestamp).getHours();
          return hour >= 22 || hour <= 7;
        }).slice(0, 10);
        const rainHours = tonightHours.filter(h => h.precipitation > 0.5).map(h => new Date(h.timestamp).getHours() + ":00");
        addBotMessage(rainHours.length > 0 ? `🌙 Ночью дождь в: ${rainHours.join(', ')}.` : `🌙 Ночь будет сухой. ✅`, 'forecast');
      } else if (text === '📅 Прогноз на день') {
        const dayHours = hourly.slice(0, 12);
        const rainHours = dayHours.filter(h => h.precipitation > 0.5).map(h => new Date(h.timestamp).getHours() + ":00");
        addBotMessage(rainHours.length > 0 ? `📅 Дождь в: ${rainHours.join(', ')}.` : `📅 Днем будет сухо. ☀️`, 'forecast');
      } else if (text === 'ℹ️ Помощь') {
        addBotMessage(`Я — RainGuard. Мониторю небо Limassol. Пришлю алерт, если дождь > 0.5мм.`);
      }
    } catch (err) {
      addBotMessage("⚠️ Превышен лимит запросов к API погоды. Попробуйте через 10-15 минут.");
    }
  };

  if (isInitializing) return null;

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="flex items-center justify-between px-4 py-2 bg-white rounded-2xl border border-slate-200 shadow-sm text-[10px] font-bold text-slate-400 uppercase tracking-widest">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            Simulator Running
          </div>
          <div className="flex items-center gap-1">
            <MapPin size={10} className="text-red-500" />
            Limassol, CY
          </div>
        </div>
        <TelegramMockup messages={messages} onSendMessage={handleUserMessage} />
        <p className="text-center text-[10px] text-slate-400 font-medium">
          RainGuard Bot v2.8 • Проверка каждые 15-20 мин
        </p>
      </div>
    </div>
  );
};

export default App;
