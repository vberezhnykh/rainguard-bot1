
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { TelegramMockup } from './components/TelegramMockup';
import { fetchWeather } from './services/weatherService';
import { generateBotResponse } from './services/geminiService';
import { BotMessage, WeatherData, LocationState } from './types';
import { MapPin, Zap, Database, Search } from 'lucide-react';

const App: React.FC = () => {
  const [messages, setMessages] = useState<BotMessage[]>([]);
  const [location, setLocation] = useState<LocationState>({ 
    lat: 34.6593, 
    lng: 33.0038, 
    address: 'Andrea Achillidi 10a, Zakaki, Limassol' 
  });
  
  const [activeProvider, setActiveProvider] = useState<'OpenWeather' | 'Gemini' | 'Cache' | 'None'>('None');
  const wasRainingRef = useRef(false);
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    const initialMsg: BotMessage = {
      id: '1',
      sender: 'bot',
      text: `Привет! Я RainGuard Bot v3.0 🛡️\nТеперь я работаю на OpenWeather API.\n\nУбедись, что OPENWEATHER_API_KEY добавлен в настройки!`,
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
      
      // Determine provider for UI
      if ((process.env as any).OPENWEATHER_API_KEY) setActiveProvider('OpenWeather');
      else setActiveProvider('Gemini');

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
      setActiveProvider('Cache');
      console.warn("Weather sync failed, using cache");
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
        addBotMessage(`Я — RainGuard. Мониторю Limassol через OpenWeather. Алерт при дожде > 0.5мм.`);
      }
    } catch (err) {
      addBotMessage("⚠️ Ошибка: Проверьте OPENWEATHER_API_KEY в настройках.");
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
              <div className={`w-2 h-2 rounded-full ${activeProvider !== 'None' ? 'bg-green-500 animate-pulse' : 'bg-slate-300'}`} />
              Simulator Active
            </div>
            <div className="flex items-center gap-1">
              <MapPin size={10} className="text-red-500" />
              Limassol, CY
            </div>
          </div>
          
          <div className="flex gap-2 pt-1">
            <div className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border ${activeProvider === 'OpenWeather' ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-slate-50 border-slate-100 text-slate-400'}`}>
              <Zap size={12} />
              <span className="text-[10px] font-bold">OpenWeather</span>
            </div>
            <div className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border ${activeProvider === 'Gemini' ? 'bg-purple-50 border-purple-200 text-purple-600' : 'bg-slate-50 border-slate-100 text-slate-400'}`}>
              <Search size={12} />
              <span className="text-[10px] font-bold">Gemini AI</span>
            </div>
            <div className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg border ${activeProvider === 'Cache' ? 'bg-orange-50 border-orange-200 text-orange-600' : 'bg-slate-50 border-slate-100 text-slate-400'}`}>
              <Database size={12} />
              <span className="text-[10px] font-bold">Cache</span>
            </div>
          </div>
        </div>

        <TelegramMockup messages={messages} onSendMessage={handleUserMessage} />
        
        <p className="text-center text-[10px] text-slate-400 font-medium leading-relaxed px-4">
          RainGuard Bot v3.0 • Переход на OpenWeather завершен. <br/>
          Квота: 1000 запросов/день (бесплатно).
        </p>
      </div>
    </div>
  );
};

export default App;
