import { create } from 'zustand';

export interface Personalization {
  date: string;
  day: string;
  location: string;
  weather: string;
  temperature: string;
  sessionId: string;
}

interface SessionState {
  sessionId: string;
  personalization?: Personalization;
  displayName?: string;
  setSessionId: (sessionId: string) => void;
  setPersonalization: (personalization: Personalization) => void;
  setDisplayName: (displayName?: string) => void;
}

function bootstrapSessionId(): string {
  if (typeof window === 'undefined') {
    return 'preview-session';
  }
  const existing = window.localStorage.getItem('tnh-session-id');
  if (existing) {
    return existing;
  }
  const generated = window.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  window.localStorage.setItem('tnh-session-id', generated);
  return generated;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessionId: bootstrapSessionId(),
  setSessionId: (sessionId) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('tnh-session-id', sessionId);
    }
    set({ sessionId });
  },
  setPersonalization: (personalization) => set({ personalization }),
  setDisplayName: (displayName) => set({ displayName }),
}));
