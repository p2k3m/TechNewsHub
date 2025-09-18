export interface GeoPayload {
  lat?: number;
  lng?: number;
  sessionId: string;
  userAgent?: string;
}

export interface GeoResponse {
  date: string;
  day: string;
  location: string;
  weather: string;
  temperature: string;
  sessionId: string;
}

export interface NewsItem {
  id: string;
  title: string;
  summary: string;
  sourceUrl?: string;
  verificationScore: number;
  publishedAt?: string;
}

export interface PatentItem {
  id: string;
  title: string;
  abstract: string;
  impactScore: number;
  filingDate?: string;
  inventors?: string[];
}

export interface AggregatedNewsResponse {
  section: string;
  timePeriod: string;
  items: NewsItem[];
  verificationSummary: string;
  generatedAt: string;
}

export interface PatentResponse {
  section: string;
  timePeriod: string;
  patents: PatentItem[];
  generatedAt: string;
}

export interface SearchResponse {
  query: string;
  results: Array<{ id: string; headline: string; summary: string; url?: string; verificationScore: number }>;
  generatedAt: string;
}

export interface RecommendationResponse {
  recommendations: Array<{ section: string; reason: string; score: number }>;
  generatedAt: string;
}

export interface RelatedContentResponse {
  section: string;
  period: string;
  item: {
    id: string;
    title: string;
    summary: string;
    verificationScore: number;
    sourceUrl?: string;
    related?: RelatedContentResponse['item'][];
  };
  generatedAt: string;
}

export interface ProfileResponse {
  email: string;
  displayName: string;
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    credentials: 'include',
    ...init,
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed for ${path}`);
  }
  return response.json() as Promise<T>;
}

export const ApiClient = {
  geoEnrich(payload: GeoPayload) {
    return request<GeoResponse>('/geo-enrich', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  fetchNews(section: string, timePeriod: string) {
    return request<AggregatedNewsResponse>('/news', {
      method: 'POST',
      body: JSON.stringify({ section, timePeriod }),
    });
  },
  fetchPatents(section: string, timePeriod: string) {
    return request<PatentResponse>('/patents', {
      method: 'POST',
      body: JSON.stringify({ section, timePeriod }),
    });
  },
  search(query: string, section?: string) {
    return request<SearchResponse>('/search', {
      method: 'POST',
      body: JSON.stringify({ query, section }),
    });
  },
  recommendations(sessionId: string) {
    return request<RecommendationResponse>('/recommendations', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    });
  },
  related(section: string, period: string, itemId: string, depth = 3) {
    return request<RelatedContentResponse>(`/content/${section}/${period}/${itemId}?depth=${depth}`, {
      method: 'GET',
    });
  },
  profile() {
    return request<ProfileResponse>('/profile/me', { method: 'GET' });
  },
};
