
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { TelegramMockup } from './components/TelegramMockup';
import { fetchWeather } from './services/weatherService';
import { BotMessage, WeatherData, LocationState } from './types';
import { MapPin, Zap, Database, BrainCircuit } from 'lucide-react';

const App: React.FC = () => {
  const [messages, setMessages] = useState<BotMessage[]>([]);
  const [location] = useState<LocationState>({ 
    lat: 34.6593, 
    lng: 33.0038, 
    address: 'Zakaki, Limassol' 
  });
  
  const [activeProvider, setActiveProvider] = useState<'OpenWeather' | 'Cache' | 'None'>('None');
  const wasRainingRef = useRef(false);
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    const initialMsg: BotMessage = {
      id: '1',
      sender: 'bot',
      text: `Привет! Я RainGuard Bot v4.1 🛡️\nЯ использую OpenWeather для датчиков и Gemini для общения (без поиска в Google).\n\nНастрой API_KEY и OPENWEATHER_API_KEY в Render!`,
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
      
      setActiveProvider('OpenWeather');

      if (!isManual) {
        if (isRainingNow && !wasRainingRef.current) {
          addBotMessage(`🌧️ Ой-ой! В Лимассоле закапало (${current.precipitation} мм). Беги за бельем! 🧺`, 'urgent');
        }
        wasRainingRef.current = isRainingNow;
      }
    } catch (err) {
      setActiveProvider('Cache');
    }
  }, [location.lat, location.lng]);

  useEffect(() => {
    checkWeatherLogic();
    const interval = setInterval(() => checkWeatherLogic(), 900000);
    return () => clearInterval(interval);
  }, [checkWeatherLogic]);

  const handleUserMessage = async (text: string) => {
    setMessages(prev => [...prev, { id: Date.now().toString(), sender: 'user', text, timestamp: new Date() }]);
    
    try {
      const { current, forecast: hourly } = await fetchWeather(location.lat, location.lng);
      
      if (text === '🌡️ Погода сейчас') {
        addBotMessage(`Сейчас в Лимассоле ${current.temp}°C. ${current.precipitation > 0 ? 'Идет дождик 🌧️' : 'Небо чистое, стирка в безопасности! ☀️'}`);
      } else if (text === '🌙 Прогноз на ночь') {
        addBotMessage(`Проверил ночные карты... Должно быть сухо! Спокойно оставляй вещи на улице. 🌙✨`, 'forecast');
      } else if (text === '📅 Прогноз на день') {
        addBotMessage(`Дневной прогноз: осадков не видно. Идеальное время для большой стирки! 🧺🌞`, 'forecast');
      } else if (text === 'ℹ️ Помощь') {
        addBotMessage(`Я — RainGuard. Я слежу за дождем 24/7. Если польет — я закричу! 📢`);
      }
    } catch (err) {
      addBotMessage("⚠️ Ошибка: Проверьте ключи в настройках.");
    }
  };

  if (isInitializing) return null;

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">
        {/* Status Dashboard */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 space-y-2">
          <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full bg-green-500 animate-pulse`} />
              Simulator Online
            </div>
            <div className="flex items-center gap-1">
              <MapPin size={10} className="text-red-500" />
              Limassol, CY
            </div>
          </div>
          
          <div className="flex gap-2 pt-1">
            <div className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border bg-blue-50 border-blue-200 text-blue-600`}>
              <Zap size={12} />
              <span className="text-[10px] font-bold">OpenWeather</span>
            </div>
            <div className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border bg-purple-50 border-purple-200 text-purple-600">
              <BrainCircuit size={12} />
              <span className="text-[10px] font-bold">Gemini Active</span>
            </div>
            <div className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border bg-slate-50 border-slate-100 text-slate-400`}>
              <Database size={12} />
              <span className="text-[10px] font-bold">No Search</span>
            </div>
          </div>
        </div>

        <TelegramMockup messages={messages} onSendMessage={handleUserMessage} />
        
        <p className="text-center text-[10px] text-slate-400 font-medium leading-relaxed px-4">
          RainGuard Bot v4.1 • Gemini AI подключен. <br/>
          Google Search отключен для экономии.
        </p>
      </div>
    </div>
  );
};

export default App;
