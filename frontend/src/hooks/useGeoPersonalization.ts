import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiClient, GeoResponse } from '../api/client';
import { useSessionStore } from './useSessionStore';

interface GeolocationState {
  ready: boolean;
  coords?: { lat: number; lng: number } | null;
}

export function useGeoPersonalization() {
  const sessionId = useSessionStore((state) => state.sessionId);
  const setSessionId = useSessionStore((state) => state.setSessionId);
  const setPersonalization = useSessionStore((state) => state.setPersonalization);
  const personalization = useSessionStore((state) => state.personalization);

  const [geoState, setGeoState] = useState<GeolocationState>({ ready: false, coords: undefined });

  useEffect(() => {
    if (typeof window === 'undefined') {
      setGeoState({ ready: true, coords: null });
      return;
    }
    if (!navigator.geolocation) {
      setGeoState({ ready: true, coords: null });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGeoState({
          ready: true,
          coords: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          },
        });
      },
      () => setGeoState({ ready: true, coords: null }),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }, []);

  const queryKey = useMemo(
    () => [
      'geo-personalization',
      sessionId,
      geoState.coords?.lat ?? 'none',
      geoState.coords?.lng ?? 'none',
    ],
    [sessionId, geoState.coords?.lat, geoState.coords?.lng],
  );

  const query = useQuery({
    queryKey,
    enabled: geoState.ready,
    staleTime: 1000 * 60 * 30,
    queryFn: async (): Promise<GeoResponse> => {
      const response = await ApiClient.geoEnrich({
        lat: geoState.coords?.lat,
        lng: geoState.coords?.lng,
        sessionId,
        userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : undefined,
      });
      return response;
    },
  });

  useEffect(() => {
    if (query.data) {
      setPersonalization(query.data);
      if (query.data.sessionId && query.data.sessionId !== sessionId) {
        setSessionId(query.data.sessionId);
      }
    }
  }, [query.data, sessionId, setPersonalization, setSessionId]);

  return {
    personalization: query.data ?? personalization,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
