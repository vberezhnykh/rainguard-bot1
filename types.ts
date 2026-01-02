
export interface WeatherData {
  temp: number;
  precipitation: number;
  windSpeed: number;
  description: string;
  timestamp: number;
}

export interface BotMessage {
  id: string;
  sender: 'bot' | 'user';
  text: string;
  timestamp: Date;
  type?: 'urgent' | 'info' | 'forecast';
}

export interface LocationState {
  lat: number;
  lng: number;
  address?: string;
}

export interface AppState {
  isMonitoring: boolean;
  location: LocationState;
  messages: BotMessage[];
  lastCheck: Date | null;
  rainForecast: WeatherData[];
}
