
import React, { useEffect, useRef } from 'react';
import { BotMessage } from '../types';
import { Menu, LayoutGrid, Calendar, Moon, Sun, Info } from 'lucide-react';

interface TelegramMockupProps {
  messages: BotMessage[];
  onSendMessage: (text: string) => void;
}

export const TelegramMockup: React.FC<TelegramMockupProps> = ({ messages, onSendMessage }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="flex flex-col h-[600px] w-full max-w-md mx-auto bg-white rounded-3xl shadow-2xl overflow-hidden border border-slate-200">
      {/* Header */}
      <div className="bg-[#54a9eb] p-4 flex items-center gap-3 text-white shadow-md z-10">
        <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center font-bold text-lg border border-white/10">
          RG
        </div>
        <div className="flex-1">
          <h3 className="font-semibold leading-none text-sm md:text-base">RainGuard Bot</h3>
          <span className="text-[10px] text-white/70">бот онлайн</span>
        </div>
        <button className="p-2 hover:bg-white/10 rounded-full transition-colors">
          <Menu size={20} />
        </button>
      </div>

      {/* Messages Area */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#e7ebf0] scroll-smooth"
      >
        {messages.map((msg) => (
          <div 
            key={msg.id} 
            className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div 
              className={`max-w-[85%] p-3 rounded-2xl shadow-sm text-sm ${
                msg.sender === 'user' 
                  ? 'bg-[#effdde] text-slate-800 rounded-tr-none' 
                  : 'bg-white text-slate-800 rounded-tl-none'
              } ${msg.type === 'urgent' ? 'border-l-4 border-red-500 animate-pulse' : ''} ${msg.type === 'forecast' ? 'border-l-4 border-green-500' : ''}`}
            >
              <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
              <div className="text-[9px] text-slate-400 text-right mt-1 opacity-70">
                {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Reply Keyboard Area */}
      <div className="p-2 bg-[#f4f4f4] border-t border-slate-200 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <button 
            onClick={() => onSendMessage('🌡️ Погода сейчас')}
            className="py-2.5 px-2 bg-white hover:bg-slate-50 border-b-2 border-slate-300 active:border-b-0 active:translate-y-[2px] rounded-lg text-[11px] font-bold text-slate-700 transition-all flex items-center justify-center gap-1.5"
          >
            <Sun size={14} className="text-orange-400" />
            Погода сейчас
          </button>
          <button 
            onClick={() => onSendMessage('📅 Прогноз на день')}
            className="py-2.5 px-2 bg-white hover:bg-slate-50 border-b-2 border-slate-300 active:border-b-0 active:translate-y-[2px] rounded-lg text-[11px] font-bold text-slate-700 transition-all flex items-center justify-center gap-1.5"
          >
            <Calendar size={14} className="text-blue-500" />
            На день
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button 
            onClick={() => onSendMessage('🌙 Прогноз на ночь')}
            className="py-2.5 px-2 bg-white hover:bg-slate-50 border-b-2 border-slate-300 active:border-b-0 active:translate-y-[2px] rounded-lg text-[11px] font-bold text-slate-700 transition-all flex items-center justify-center gap-1.5"
          >
            <Moon size={14} className="text-indigo-400" />
            На ночь
          </button>
          <button 
            onClick={() => onSendMessage('ℹ️ Помощь')}
            className="py-2.5 px-2 bg-white hover:bg-slate-50 border-b-2 border-slate-300 active:border-b-0 active:translate-y-[2px] rounded-lg text-[11px] font-bold text-slate-500 transition-all flex items-center justify-center gap-1.5"
          >
            <Info size={14} />
            Помощь
          </button>
        </div>
      </div>

      {/* Fake Input Bar */}
      <div className="px-4 py-3 bg-white flex items-center gap-3">
        <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
          📎
        </div>
        <div className="flex-1 bg-slate-50 px-3 py-1.5 rounded-full text-slate-400 text-xs border border-slate-100">
          Сообщение...
        </div>
        <div className="text-[#54a9eb] font-bold text-xl">
          🎤
        </div>
      </div>
    </div>
  );
};
