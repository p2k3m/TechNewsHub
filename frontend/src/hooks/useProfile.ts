import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiClient, ProfileResponse } from '../api/client';
import { useSessionStore } from './useSessionStore';

export function useProfile() {
  const setDisplayName = useSessionStore((state) => state.setDisplayName);
  const displayName = useSessionStore((state) => state.displayName);

  const query = useQuery<ProfileResponse, Error>({
    queryKey: ['profile'],
    queryFn: () => ApiClient.profile(),
    retry: 1,
    staleTime: 1000 * 60 * 60,
  });

  useEffect(() => {
    if (query.data?.displayName) {
      setDisplayName(query.data.displayName);
    }
  }, [query.data, setDisplayName]);

  return {
    profile: query.data,
    displayName: query.data?.displayName ?? displayName,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
