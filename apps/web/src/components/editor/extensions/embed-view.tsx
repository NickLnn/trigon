'use client';

import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import type { EmbedInfo } from '@trigon/shared';
import { ExternalLink, Globe } from 'lucide-react';
import { useEffect } from 'react';
import { api } from '@/lib/api';

export function EmbedView({ node, updateAttributes, selected, editor }: ReactNodeViewProps) {
  const { url, kind, embedUrl, title, description, thumbnailUrl, provider } = node.attrs as {
    url: string;
    kind: 'video' | 'link';
    embedUrl: string | null;
    title: string | null;
    description: string | null;
    thumbnailUrl: string | null;
    provider: string | null;
  };

  // Unfurl once, by whichever collaborator inserted it (attrs then sync to everyone).
  useEffect(() => {
    if (title || !url || !editor.isEditable) return;
    let cancelled = false;
    api<EmbedInfo>(`/embeds/unfurl?url=${encodeURIComponent(url)}`)
      .then((info) => {
        if (cancelled) return;
        updateAttributes({
          title: info.title ?? url,
          description: info.description,
          thumbnailUrl: info.thumbnailUrl,
          provider: info.provider,
        });
      })
      .catch(() => !cancelled && updateAttributes({ title: url }));
    return () => {
      cancelled = true;
    };
  }, [url, title, editor, updateAttributes]);

  const ring = selected ? 'ring-2 ring-accent' : '';

  if (kind === 'video' && embedUrl) {
    return (
      <NodeViewWrapper className="my-4" data-drag-handle>
        <div className={`relative aspect-video w-full overflow-hidden rounded-2xl bg-black ${ring}`}>
          <iframe
            src={embedUrl}
            title={title ?? 'Embedded video'}
            className="absolute inset-0 h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          />
        </div>
        {title && <p className="mt-2 text-meta text-ink-3">{title}</p>}
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="my-3" data-drag-handle>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={`press flex overflow-hidden rounded-2xl border border-line bg-surface no-underline ${ring}`}
        contentEditable={false}
      >
        <div className="min-w-0 flex-1 p-4">
          <div className="flex items-center gap-1.5 text-meta text-ink-3">
            <Globe className="size-3.5" />
            <span className="truncate">{provider ?? new URL(url).hostname}</span>
          </div>
          <p className="mt-1 line-clamp-2 font-semibold text-ink">{title ?? url}</p>
          {description && <p className="mt-1 line-clamp-2 text-meta text-ink-2">{description}</p>}
        </div>
        {thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnailUrl} alt="" className="w-28 shrink-0 object-cover sm:w-40" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <div className="grid w-16 shrink-0 place-items-center text-ink-3">
            <ExternalLink className="size-5" />
          </div>
        )}
      </a>
    </NodeViewWrapper>
  );
}
