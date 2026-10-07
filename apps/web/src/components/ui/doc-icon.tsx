import type { DocumentKind } from '@trigon/shared';
import { File, FileText, FileType, Folder, Image as ImageIcon, NotebookPen } from 'lucide-react';

const tone = {
  page: 'bg-accent-soft text-accent',
  folder: 'bg-warning/15 text-warning',
  pdf: 'bg-danger/10 text-danger',
  docx: 'bg-[#2b579a]/12 text-[#2b579a] dark:text-[#6d9eeb]',
  image: 'bg-success/12 text-success',
  file: 'bg-surface-2 text-ink-2',
};

export function fileFlavor(mimeType: string | null | undefined, title = ''): 'pdf' | 'docx' | 'image' | 'file' {
  if (mimeType === 'application/pdf' || /\.pdf$/i.test(title)) return 'pdf';
  if (mimeType?.includes('wordprocessingml') || /\.docx$/i.test(title)) return 'docx';
  if (mimeType?.startsWith('image/')) return 'image';
  return 'file';
}

/** Rounded icon bubble for a tree node, coloured by type — the visual anchor of every list row. */
export function DocIcon({
  kind,
  mimeType,
  title,
  emoji,
  size = 'md',
}: {
  kind: DocumentKind;
  mimeType?: string | null;
  title?: string;
  emoji?: string | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  const box = size === 'sm' ? 'size-7 rounded-lg' : size === 'lg' ? 'size-12 rounded-2xl' : 'size-10 rounded-xl';
  const glyph = size === 'sm' ? 'size-3.5' : size === 'lg' ? 'size-6' : 'size-5';
  if (emoji) {
    return <span className={`${box} grid shrink-0 place-items-center bg-surface-2 ${size === 'sm' ? 'text-sm' : 'text-lg'}`}>{emoji}</span>;
  }
  if (kind === 'folder') return <span className={`${box} grid shrink-0 place-items-center ${tone.folder}`}><Folder className={glyph} /></span>;
  if (kind === 'page') return <span className={`${box} grid shrink-0 place-items-center ${tone.page}`}><NotebookPen className={glyph} /></span>;
  const flavor = fileFlavor(mimeType, title);
  const Icon = flavor === 'pdf' ? FileText : flavor === 'docx' ? FileType : flavor === 'image' ? ImageIcon : File;
  return <span className={`${box} grid shrink-0 place-items-center ${tone[flavor]}`}><Icon className={glyph} /></span>;
}

export function relativeTime(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (diff < 60) return 'just now';
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), 'minute');
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), 'hour');
  if (diff < 86400 * 7) return rtf.format(-Math.round(diff / 86400), 'day');
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
