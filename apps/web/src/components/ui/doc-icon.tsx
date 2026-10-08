/* eslint-disable @next/next/no-img-element */
import { fileExtension, iconImageId, type DocumentKind } from '@trigon/shared';
import { BookOpenText, File, FileSpreadsheet, FileText, FileType, Folder, Image as ImageIcon, ListChecks, NotebookPen, Presentation, Workflow } from 'lucide-react';

export type FileFlavor = 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'vsdx' | 'image' | 'file';

const tone: Record<FileFlavor | 'page' | 'folder', string> = {
  page: 'bg-accent-soft text-accent',
  folder: 'bg-warning/15 text-warning',
  pdf: 'bg-danger/10 text-danger',
  docx: 'bg-[#2b579a]/12 text-[#2b579a] dark:text-[#7aa7f0]',
  xlsx: 'bg-[#217346]/12 text-[#217346] dark:text-[#5fcf8f]',
  pptx: 'bg-[#d24726]/12 text-[#d24726] dark:text-[#ff8a68]',
  vsdx: 'bg-[#3955a3]/12 text-[#3955a3] dark:text-[#8aa2ea]',
  image: 'bg-success/12 text-success',
  file: 'bg-surface-2 text-ink-2',
};

const GLYPH = { pdf: FileText, docx: FileType, xlsx: FileSpreadsheet, pptx: Presentation, vsdx: Workflow, image: ImageIcon, file: File };

export function fileFlavor(mimeType: string | null | undefined, title = ''): FileFlavor {
  const ext = fileExtension(title);
  if (mimeType === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (['docx', 'docm', 'dotx', 'doc', 'odt', 'rtf'].includes(ext) || mimeType?.includes('wordprocessingml')) return 'docx';
  if (['xlsx', 'xlsm', 'xltx', 'xls', 'ods'].includes(ext) || mimeType?.includes('spreadsheetml')) return 'xlsx';
  if (['pptx', 'pptm', 'potx', 'ppt', 'odp'].includes(ext) || mimeType?.includes('presentationml')) return 'pptx';
  if (['vsdx', 'vsd', 'vsdm', 'vstx'].includes(ext) || mimeType?.includes('visio')) return 'vsdx';
  if (mimeType?.startsWith('image/')) return 'image';
  return 'file';
}

const BOX = { sm: 'size-7 rounded-lg', md: 'size-10 rounded-xl', lg: 'size-12 rounded-2xl', xl: 'size-16 rounded-[1.25rem]' };
const GLYPH_SIZE = { sm: 'size-3.5', md: 'size-5', lg: 'size-6', xl: 'size-8' };

/** A custom icon value: emoji or stored image (`img:<id>`). Returns null when there is none. */
export function CustomIcon({ icon, size = 'md' }: { icon: string | null | undefined; size?: keyof typeof BOX }) {
  if (!icon) return null;
  const imageId = iconImageId(icon);
  if (imageId) {
    // White plate keeps original brand colours legible in dark mode too.
    return (
      <span className={`${BOX[size]} grid shrink-0 place-items-center overflow-hidden bg-white ring-1 ring-line`}>
        <img src={`/api/icons/${imageId}`} alt="" className="size-[72%] object-contain" loading="lazy" draggable={false} />
      </span>
    );
  }
  return <span className={`${BOX[size]} grid shrink-0 place-items-center bg-surface-2 ${size === 'sm' ? 'text-sm' : size === 'xl' ? 'text-3xl' : 'text-lg'}`}>{icon}</span>;
}

/** Rounded icon bubble for a tree node — custom icon if set, otherwise coloured by type. */
export function DocIcon({
  kind,
  mimeType,
  title,
  emoji,
  size = 'md',
  bare = false,
  pageType,
}: {
  kind: DocumentKind;
  mimeType?: string | null;
  title?: string;
  /** Custom icon value (emoji or img:<id>). */
  emoji?: string | null;
  size?: keyof typeof BOX;
  /** Glyph only, no tinted bubble — for the navy sidebar. */
  bare?: boolean;
  pageType?: string;
}) {
  if (emoji) return <CustomIcon icon={emoji} size={size} />;
  const box = `${BOX[size]} grid shrink-0 place-items-center`;
  const flavor = kind === 'file' ? fileFlavor(mimeType, title) : null;
  const Icon = kind === 'folder' ? Folder : kind === 'page' ? (pageType === 'runbook' ? ListChecks : pageType === 'kb' ? BookOpenText : NotebookPen) : GLYPH[flavor!];
  const toneKey = kind === 'folder' ? 'folder' : kind === 'page' ? 'page' : flavor!;
  if (bare) {
    const bareTone: Record<string, string> = {
      folder: 'text-navy-warn', page: 'text-[#8fb2ff]', pdf: 'text-[#ff8f86]', docx: 'text-[#8fb2ff]',
      xlsx: 'text-[#6fdca0]', pptx: 'text-[#ffa07f]', vsdx: 'text-[#a4b6f0]', image: 'text-navy-good', file: 'text-navy-ink-3',
    };
    return <span className={`${box} ${bareTone[toneKey]}`}><Icon className={GLYPH_SIZE[size]} /></span>;
  }
  return <span className={`${box} ${tone[toneKey]}`}><Icon className={GLYPH_SIZE[size]} /></span>;
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

/** Space badge: brand logo / emoji on the space colour, falling back to the first letter. */
export function SpaceIcon({ space, size = 'sm' }: { space: { name: string; icon: string | null; color: string | null }; size?: keyof typeof BOX }) {
  if (iconImageId(space.icon)) return <CustomIcon icon={space.icon} size={size} />;
  return (
    <span
      className={`${BOX[size]} grid shrink-0 place-items-center font-semibold ${size === 'sm' ? 'text-sm' : size === 'xl' ? 'text-3xl' : 'text-lg'}`}
      style={{ background: space.color ?? 'var(--surface-2)', color: '#191c1f' }}
    >
      {space.icon || space.name[0]?.toUpperCase()}
    </span>
  );
}
