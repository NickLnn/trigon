'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminGroup, AdminUser, AllSettings, EntraProvisionStatus, EntraSettings, GeneralSettings, LdapSettings } from '@trigon/shared';
import { api } from './api';

export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => api<AllSettings>('/settings') });

export function useSaveSettings<K extends 'general' | 'entra' | 'ldap'>(section: K) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (value: K extends 'general' ? GeneralSettings : K extends 'entra' ? EntraSettings : LdapSettings) =>
      api(`/settings/${section}`, { method: 'PUT', json: value }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['auth-config'] });
      qc.invalidateQueries({ queryKey: ['directory-status'] });
    },
  });
}

export const useTestConnection = (section: 'entra' | 'ldap') =>
  useMutation({
    mutationFn: (value: EntraSettings | LdapSettings) =>
      api<{ ok: boolean; message: string }>(`/settings/${section}/test`, { method: 'POST', json: value }),
  });

export interface DirectoryStatus {
  entra: { enabled: boolean; running: boolean; lastGroupSync: string | null; accounts: number };
  ldap: { enabled: boolean; running: boolean; lastGroupSync: string | null; accounts: number };
}

export const useDirectoryStatus = () =>
  useQuery({ queryKey: ['directory-status'], queryFn: () => api<DirectoryStatus>('/directory/status'), refetchInterval: 15_000 });

export function useSyncNow(source: 'entra' | 'ldap') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ users: number; groups: number; memberships: number; durationMs: number }>(`/directory/sync/${source}`, { method: 'POST' }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['directory-status'] });
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      qc.invalidateQueries({ queryKey: ['admin-groups'] });
    },
  });
}

export const useProvisionStatus = (poll: boolean) =>
  useQuery({
    queryKey: ['entra-provision'],
    queryFn: () => api<EntraProvisionStatus>('/settings/entra/provision'),
    refetchInterval: poll ? 2000 : false,
  });

export function useStartProvision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<EntraProvisionStatus>('/settings/entra/provision', { method: 'POST' }),
    onSuccess: (data) => qc.setQueryData(['entra-provision'], data),
  });
}

export const useAdminUsers = (q: string) =>
  useQuery({ queryKey: ['admin-users', q], queryFn: () => api<AdminUser[]>(`/admin/users?q=${encodeURIComponent(q)}`), placeholderData: (p) => p });

export function useAdminMutation<T>(fn: (input: T) => Promise<unknown>, keys: string[][] = [['admin-users'], ['admin-groups']]) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => keys.forEach((k) => qc.invalidateQueries({ queryKey: k })) });
}

export const useAdminGroups = (q: string) =>
  useQuery({ queryKey: ['admin-groups', q], queryFn: () => api<AdminGroup[]>(`/admin/groups?q=${encodeURIComponent(q)}`), placeholderData: (p) => p });

export const useGroupMembers = (id: string | null) =>
  useQuery({
    queryKey: ['admin-groups', 'members', id],
    queryFn: () => api<{ id: string; email: string; displayName: string }[]>(`/admin/groups/${id}/members`),
    enabled: !!id,
  });
