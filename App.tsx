
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { TelegramMockup } from './components/TelegramMockup';
import { fetchWeather } from './services/weatherService';
import { generateBotResponse } from './services/geminiService';
import { BotMessage, WeatherData, LocationState } from './types';
import { ShieldCheck, MapPin, RefreshCw } from 'lucide-react';

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
      text: `Привет! Я RainGuard Bot v2.8 🛡️\nЯ слежу за погодой в реальном времени.\n\nИспользуй кнопки ниже, чтобы проверить прогноз!`,
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
      const { current, forecast: hourly } = await fetchWeather(location.lat, location.lng);
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
      console.error("Monitoring error:", err);
    }
  }, [location.lat, location.lng]);

  // Background monitoring simulation
  useEffect(() => {
    checkWeatherLogic();
    const interval = setInterval(() => checkWeatherLogic(), 30000);
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
        if (rainHours.length > 0) {
          addBotMessage(`🌙 Ночной прогноз (22:00 - 07:00):\n⚠️ Ожидается дождь в: ${rainHours.join(', ')}. Уберите вещи!`, 'urgent');
        } else {
          addBotMessage(`🌙 Ночной прогноз (22:00 - 07:00):\n✅ Ночь будет сухой. Оставляй вещи спокойно!`, 'forecast');
        }
      } else if (text === '📅 Прогноз на день') {
        const dayHours = hourly.slice(0, 12);
        const rainHours = dayHours.filter(h => h.precipitation > 0.5).map(h => new Date(h.timestamp).getHours() + ":00");
        const maxTemp = Math.max(...dayHours.map(h => h.temp));
        if (rainHours.length > 0) {
          addBotMessage(`📅 На ближайшие 12 часов:\n🌡 Макс: ${maxTemp}°C\n🌧 Дождь в: ${rainHours.join(', ')}.`, 'urgent');
        } else {
          addBotMessage(`📅 На ближайшие 12 часов:\n🌡 Макс: ${maxTemp}°C\n☀️ Дождя не будет. Стираем!`, 'forecast');
        }
      } else if (text === 'ℹ️ Помощь') {
        addBotMessage(`Я — RainGuard. Мониторю небо Limassol. Если начнется дождь (>0.5мм), я пришлю уведомление!`);
      }
    } catch (err) {
      addBotMessage("⚠️ Ошибка связи с сервером погоды.");
    }
  };

  if (isInitializing) return null;

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">
        {/* Simple Status Header */}
        <div className="flex items-center justify-between px-4 py-2 bg-white rounded-2xl border border-slate-200 shadow-sm text-[10px] font-bold text-slate-400 uppercase tracking-widest">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            Simulator Active
          </div>
          <div className="flex items-center gap-1">
            <MapPin size={10} className="text-red-500" />
            Limassol, CY
          </div>
        </div>

        {/* The Simulator */}
        <TelegramMockup messages={messages} onSendMessage={handleUserMessage} />
        
        <p className="text-center text-[10px] text-slate-400 font-medium">
          RainGuard Bot v2.8 • Порог осадков: 0.5 мм
        </p>
      </div>
    </div>
  );
};

export default App;
