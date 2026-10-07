'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DocumentKind, DocumentNode, PermissionLevel, SpaceSummary } from '@trigon/shared';
import { api } from './api';

export interface RecentDoc {
  id: string;
  title: string;
  kind: DocumentKind;
  icon: string | null;
  mimeType: string | null;
  spaceId: string;
  spaceName: string;
  spaceColor: string | null;
  updatedAt: string;
}

export interface SearchHit {
  id: string;
  title: string;
  kind: DocumentKind;
  icon: string | null;
  spaceId: string;
  spaceName: string;
  snippet: string;
  updatedAt: string;
}

export interface DocumentDetail {
  id: string;
  spaceId: string;
  parentId: string | null;
  kind: DocumentKind;
  title: string;
  icon: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  updatedAt: string;
  importHtml: string | null;
  myPermission: PermissionLevel;
}

export const useSpaces = () => useQuery({ queryKey: ['spaces'], queryFn: () => api<SpaceSummary[]>('/spaces') });

export const useSpace = (id: string) =>
  useQuery({ queryKey: ['space', id], queryFn: () => api<SpaceSummary & { createdAt: string }>(`/spaces/${id}`) });

export const useTree = (spaceId: string | undefined) =>
  useQuery({
    queryKey: ['tree', spaceId],
    queryFn: () => api<DocumentNode[]>(`/spaces/${spaceId}/tree`),
    enabled: !!spaceId,
  });

export const useRecent = () => useQuery({ queryKey: ['recent'], queryFn: () => api<RecentDoc[]>('/documents/recent') });

export const useDocument = (id: string) =>
  useQuery({ queryKey: ['document', id], queryFn: () => api<DocumentDetail>(`/documents/${id}`), enabled: !!id });

export const useSearch = (q: string) =>
  useQuery({
    queryKey: ['search', q],
    queryFn: () => api<SearchHit[]>(`/documents/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
    placeholderData: (prev) => prev,
  });

export function useCreateDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { spaceId: string; parentId?: string | null; kind: 'page' | 'folder'; title?: string }) =>
      api<{ id: string; title: string; kind: DocumentKind }>('/documents', {
        method: 'POST',
        json: { ...input, parentId: input.parentId ?? undefined },
      }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['tree', v.spaceId] });
      qc.invalidateQueries({ queryKey: ['recent'] });
    },
  });
}

export function useUploadFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { spaceId: string; parentId?: string | null; file: File }) => {
      const form = new FormData();
      form.append('spaceId', input.spaceId);
      if (input.parentId) form.append('parentId', input.parentId);
      form.append('file', input.file);
      return api<{ id: string; title: string }>('/files', { method: 'POST', body: form });
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['tree', v.spaceId] });
      qc.invalidateQueries({ queryKey: ['recent'] });
    },
  });
}

export function useUpdateDocument(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: { title?: string; icon?: string; parentId?: string | null; position?: number }) =>
      api(`/documents/${id}`, { method: 'PATCH', json: patch }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document', id] });
      qc.invalidateQueries({ queryKey: ['tree'] });
      qc.invalidateQueries({ queryKey: ['recent'] });
    },
  });
}

export function useCreateSpace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; description?: string; icon?: string; color?: string }) =>
      api<{ id: string }>('/spaces', { method: 'POST', json: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['spaces'] }),
  });
}

/** Move/reorder a node in the tree (drag & drop). */
export function useMoveDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, parentId, position }: { id: string; spaceId: string; parentId: string | null; position: number }) =>
      api(`/documents/${id}`, { method: 'PATCH', json: { parentId, position } }),
    // Optimistic: reshape the cached tree immediately so the drop feels instant.
    onMutate: async ({ id, spaceId, parentId, position }) => {
      await qc.cancelQueries({ queryKey: ['tree', spaceId] });
      const prev = qc.getQueryData<DocumentNode[]>(['tree', spaceId]);
      if (prev) {
        const flat: DocumentNode[] = [];
        const walk = (ns: DocumentNode[]) => ns.forEach((n) => (flat.push({ ...n, children: undefined }), n.children && walk(n.children)));
        walk(prev);
        const moved = flat.map((n) => (n.id === id ? { ...n, parentId, position } : n));
        qc.setQueryData(['tree', spaceId], buildTree(moved));
      }
      return { prev };
    },
    onError: (_e, v, ctx) => ctx?.prev && qc.setQueryData(['tree', v.spaceId], ctx.prev),
    onSettled: (_d, _e, v) => qc.invalidateQueries({ queryKey: ['tree', v.spaceId] }),
  });
}

export function buildTree(rows: DocumentNode[]): DocumentNode[] {
  const byId = new Map(rows.map((r) => [r.id, { ...r, children: [] as DocumentNode[] }]));
  const roots: DocumentNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  const sort = (list: DocumentNode[]) => {
    list.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
    list.forEach((n) => sort(n.children ?? []));
  };
  sort(roots);
  return roots;
}

/** Find a node and the chain of ancestors leading to it. */
export function findPath(nodes: DocumentNode[], id: string, trail: DocumentNode[] = []): DocumentNode[] | null {
  for (const n of nodes) {
    if (n.id === id) return [...trail, n];
    const inner = n.children ? findPath(n.children, id, [...trail, n]) : null;
    if (inner) return inner;
  }
  return null;
}
