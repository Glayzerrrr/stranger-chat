export type Message = {
  id: string;
  text: string;
  sender: 'me' | 'stranger';
  timestamp: number;
};

export type ChatState = 'idle' | 'searching' | 'connected' | 'disconnected';
