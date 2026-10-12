'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminGroup, AdminUser, AllSettings, DirectoryPick, EmailMicrosoftStatus, EmailSettings, EntraProvisionStatus, EntraSettings, GeneralSettings, LdapSettings, SyncSourceStatus } from '@trigon/shared';
import { api } from './api';

export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => api<AllSettings>('/settings') });

type SectionValue<K> = K extends 'general' ? GeneralSettings : K extends 'entra' ? EntraSettings : K extends 'email' ? EmailSettings : LdapSettings;

export function useSaveSettings<K extends 'general' | 'entra' | 'ldap' | 'email'>(section: K) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (value: K extends 'general' ? Partial<GeneralSettings> : SectionValue<K>) =>
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
  entra: SyncSourceStatus;
  ldap: SyncSourceStatus;
}

/** Polls fast while a sync is running, slowly otherwise. */
export const useDirectoryStatus = () =>
  useQuery({
    queryKey: ['directory-status'],
    queryFn: () => api<DirectoryStatus>('/directory/status'),
    refetchInterval: (q) => (q.state.data?.entra.running || q.state.data?.ldap.running ? 1500 : 15_000),
  });

/** Starts a background sync; progress and the result come from useDirectoryStatus. */
export function useSyncNow(source: 'entra' | 'ldap') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ started: boolean }>(`/directory/sync/${source}`, { method: 'POST' }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['directory-status'] });
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      qc.invalidateQueries({ queryKey: ['admin-groups'] });
    },
  });
}

export function useSaveEntraScope() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scope: { syncScope: 'all' | 'selected'; syncGroups: DirectoryPick[]; syncUsers: DirectoryPick[] }) =>
      api('/settings/entra/scope', { method: 'PUT', json: scope }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
}

export const useEntraDirectorySearch = (type: 'group' | 'user', q: string, enabled: boolean) =>
  useQuery({
    queryKey: ['entra-directory', type, q],
    queryFn: () => api<DirectoryPick[]>(`/settings/entra/directory?type=${type}&q=${encodeURIComponent(q)}`),
    enabled,
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });

export const useProvisionStatus = (poll: boolean) =>
  useQuery({
    queryKey: ['entra-provision'],
    queryFn: () => api<EntraProvisionStatus>('/settings/entra/provision'),
    refetchInterval: poll ? 2000 : false,
  });

export function useStartProvision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { publicUrl: string; mail: boolean }) => api<EntraProvisionStatus>('/settings/entra/provision', { method: 'POST', json: input }),
    onSuccess: (data) => qc.setQueryData(['entra-provision'], data),
  });
}

export const useEmailTest = () =>
  useMutation({
    mutationFn: (input: EmailSettings & { to: string }) =>
      api<{ ok: boolean; message: string }>('/settings/email/test', { method: 'POST', json: input }),
  });

export const useEmailMicrosoftStatus = (enabled: boolean) =>
  useQuery({ queryKey: ['email-microsoft'], queryFn: () => api<EmailMicrosoftStatus>('/settings/email/microsoft'), enabled });

export function useDisconnectEntra() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ ok: boolean; message: string }>('/settings/entra/disconnect', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['entra-provision'] });
      qc.invalidateQueries({ queryKey: ['directory-status'] });
    },
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
