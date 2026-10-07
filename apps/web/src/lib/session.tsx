'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SessionUser } from '@trigon/shared';
import { useCallback } from 'react';
import { api, ApiError } from './api';

export function useSession() {
  const query = useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      try {
        return await api<SessionUser>('/auth/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
  return { user: query.data ?? null, loading: query.isPending, error: query.error };
}

export function useSignOut() {
  const qc = useQueryClient();
  return useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_PRIVATE_CACHE' });
    qc.clear();
    location.href = '/login';
  }, [qc]);
}
