'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CommentsResponse } from '@trigon/shared';
import { api } from './api';

const key = (documentId: string) => ['comments', documentId];

/** A page's discussions; refreshed every 20 s while the page is open, so others' comments show up. */
export const useComments = (documentId: string, enabled = true) =>
  useQuery({
    queryKey: key(documentId),
    queryFn: () => api<CommentsResponse>(`/documents/${documentId}/comments`),
    enabled,
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
  });

function useCommentMutation<T, R = unknown>(documentId: string, fn: (input: T) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => qc.invalidateQueries({ queryKey: key(documentId) }) });
}

export const useStartThread = (documentId: string) =>
  useCommentMutation(documentId, (input: { body: string; anchorFrom?: string; anchorTo?: string; quote?: string }) =>
    api<{ id: string }>(`/documents/${documentId}/comments`, { method: 'POST', json: input }),
  );

export const useReply = (documentId: string) =>
  useCommentMutation(documentId, ({ threadId, body }: { threadId: string; body: string }) => api(`/comment-threads/${threadId}/replies`, { method: 'POST', json: { body } }));

export const useResolve = (documentId: string) =>
  useCommentMutation(documentId, ({ threadId, resolved }: { threadId: string; resolved: boolean }) =>
    api(`/comment-threads/${threadId}`, { method: 'PATCH', json: { resolved } }),
  );

export const useEditComment = (documentId: string) =>
  useCommentMutation(documentId, ({ id, body }: { id: string; body: string }) => api(`/comments/${id}`, { method: 'PATCH', json: { body } }));

export const useDeleteComment = (documentId: string) => useCommentMutation(documentId, (id: string) => api(`/comments/${id}`, { method: 'DELETE' }));
