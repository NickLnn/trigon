'use client';

import * as Menu from '@radix-ui/react-dropdown-menu';
import { useQueryClient } from '@tanstack/react-query';
import type { DocumentNode, SpaceSummary } from '@trigon/shared';
import { Download, FilePlus2, MoreHorizontal, Pencil, Share2, Smile, Trash2 } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { CreateSheet } from '@/components/ui/create-sheet';
import { IconPicker } from '@/components/ui/icon-picker';
import { api } from '@/lib/api';
import { ShareSheet } from './share-sheet';

function Item({ icon, children, onSelect, danger }: { icon: ReactNode; children: ReactNode; onSelect: () => void; danger?: boolean }) {
  return (
    <Menu.Item
      onSelect={onSelect}
      className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-surface-2 ${danger ? 'text-danger' : ''}`}
    >
      <span className={danger ? '' : 'text-ink-3'}>{icon}</span>
      {children}
    </Menu.Item>
  );
}

function RenameSheet({ open, onOpenChange, title, initial, onSave }: { open: boolean; onOpenChange: (v: boolean) => void; title: string; initial: string; onSave: (v: string) => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const v = String(new FormData(e.currentTarget).get('name') || '').trim();
    if (!v) return;
    setBusy(true);
    try {
      await onSave(v);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title={title}>
      <form onSubmit={submit} className="space-y-4">
        <input
          name="name"
          defaultValue={initial}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          maxLength={255}
          className="w-full rounded-2xl bg-surface-2 px-4 py-3.5 text-[1rem] outline-none ring-accent focus:ring-2"
        />
        <button disabled={busy} className="press w-full rounded-pill bg-accent py-3 font-semibold text-accent-ink disabled:opacity-60">
          Save
        </button>
      </form>
    </BottomSheet>
  );
}

function ConfirmSheet({ open, onOpenChange, title, body, action, onConfirm }: { open: boolean; onOpenChange: (v: boolean) => void; title: string; body: ReactNode; action: string; onConfirm: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title={title}>
      <p className="text-ink-2">{body}</p>
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      <div className="mt-6 flex gap-2">
        <button onClick={() => onOpenChange(false)} className="press flex-1 rounded-pill bg-surface-2 py-3 font-semibold">
          Cancel
        </button>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onConfirm();
              onOpenChange(false);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          className="press flex-1 rounded-pill bg-danger py-3 font-semibold text-white disabled:opacity-60"
        >
          {action}
        </button>
      </div>
    </BottomSheet>
  );
}

const menuContent = 'z-50 min-w-52 rounded-2xl bg-surface p-1.5 shadow-float ring-1 ring-line data-[state=open]:animate-[fade-in_120ms_ease-out]';

/** "⋯" menu for a tree node: rename, icon, add inside, download, delete. Also opened by right-click via `open`. */
export function NodeActions({
  node,
  canEdit,
  open,
  onOpenChange,
  triggerClassName = '',
}: {
  node: DocumentNode;
  canEdit: boolean;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  triggerClassName?: string;
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const params = useParams<{ docId?: string }>();
  const [dialog, setDialog] = useState<'rename' | 'icon' | 'delete' | 'create' | 'share' | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['tree', node.spaceId] });
    qc.invalidateQueries({ queryKey: ['recent'] });
    qc.invalidateQueries({ queryKey: ['document', node.id] });
  };
  const patch = (body: Record<string, unknown>) => api(`/documents/${node.id}`, { method: 'PATCH', json: body }).then(refresh);
  const kindLabel = node.kind === 'folder' ? 'folder' : node.kind === 'page' ? 'page' : 'file';

  if (!canEdit && node.kind !== 'file') return null;

  return (
    <>
      <Menu.Root open={open} onOpenChange={onOpenChange} modal={false}>
        <Menu.Trigger
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          className={`grid size-6 shrink-0 place-items-center rounded-md text-ink-3 hover:bg-surface-3 hover:text-ink data-[state=open]:bg-surface-3 ${triggerClassName}`}
          aria-label={`Actions for ${node.title}`}
        >
          <MoreHorizontal className="size-4" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content align="start" sideOffset={4} className={menuContent} onClick={(e) => e.stopPropagation()}>
            {canEdit && (
              <>
                <Item icon={<Pencil className="size-4" />} onSelect={() => setDialog('rename')}>
                  Rename
                </Item>
                <Item icon={<Smile className="size-4" />} onSelect={() => setDialog('icon')}>
                  Change icon
                </Item>
                {node.kind !== 'file' && (
                  <Item icon={<FilePlus2 className="size-4" />} onSelect={() => setDialog('create')}>
                    Add inside…
                  </Item>
                )}
                <Item icon={<Share2 className="size-4" />} onSelect={() => setDialog('share')}>
                  Share and permissions
                </Item>
              </>
            )}
            {node.kind === 'file' && (
              <Item icon={<Download className="size-4" />} onSelect={() => window.open(`/api/files/${node.id}/content`, '_blank')}>
                Download
              </Item>
            )}
            {canEdit && (
              <>
                <Menu.Separator className="my-1 h-px bg-line" />
                <Item icon={<Trash2 className="size-4" />} danger onSelect={() => setDialog('delete')}>
                  Delete
                </Item>
              </>
            )}
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>

      <RenameSheet open={dialog === 'rename'} onOpenChange={(v) => !v && setDialog(null)} title={`Rename ${kindLabel}`} initial={node.title} onSave={(title) => patch({ title })} />
      <IconPicker open={dialog === 'icon'} onOpenChange={(v) => !v && setDialog(null)} current={node.icon} onSelect={(icon) => patch({ icon: icon ?? '' })} />
      <ConfirmSheet
        open={dialog === 'delete'}
        onOpenChange={(v) => !v && setDialog(null)}
        title={`Delete ${kindLabel}?`}
        body={
          <>
            <b>{node.title}</b>
            {node.children?.length ? ` and the ${node.children.length} item${node.children.length === 1 ? '' : 's'} inside it` : ''} will be removed.
          </>
        }
        action="Delete"
        onConfirm={async () => {
          await api(`/documents/${node.id}`, { method: 'DELETE' });
          refresh();
          if (params.docId === node.id) router.push(`/spaces/${node.spaceId}`);
        }}
      />
      {dialog === 'create' && <CreateSheet open onOpenChange={(v) => !v && setDialog(null)} spaceId={node.spaceId} parentId={node.id} />}
      {dialog === 'share' && <ShareSheet open onOpenChange={(v) => !v && setDialog(null)} type="document" id={node.id} name={node.title} />}
    </>
  );
}

/** "⋯" menu for a space: rename, icon, delete (space managers only). */
export function SpaceActions({ space, triggerClassName = '' }: { space: SpaceSummary; triggerClassName?: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [dialog, setDialog] = useState<'rename' | 'icon' | 'delete' | 'share' | null>(null);
  if (space.myPermission !== 'manage') return null;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['spaces'] });
    qc.invalidateQueries({ queryKey: ['space', space.id] });
  };
  const patch = (body: Record<string, unknown>) => api(`/spaces/${space.id}`, { method: 'PATCH', json: body }).then(refresh);

  return (
    <>
      <Menu.Root modal={false}>
        <Menu.Trigger
          onClick={(e) => e.stopPropagation()}
          className={`grid size-6 shrink-0 place-items-center rounded-md text-ink-3 hover:bg-surface-3 hover:text-ink data-[state=open]:bg-surface-3 ${triggerClassName}`}
          aria-label={`Actions for ${space.name}`}
        >
          <MoreHorizontal className="size-4" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content align="start" sideOffset={4} className={menuContent}>
            <Item icon={<Pencil className="size-4" />} onSelect={() => setDialog('rename')}>
              Rename space
            </Item>
            <Item icon={<Smile className="size-4" />} onSelect={() => setDialog('icon')}>
              Change icon
            </Item>
            <Item icon={<Share2 className="size-4" />} onSelect={() => setDialog('share')}>
              Members and permissions
            </Item>
            <Menu.Separator className="my-1 h-px bg-line" />
            <Item icon={<Trash2 className="size-4" />} danger onSelect={() => setDialog('delete')}>
              Delete space
            </Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      <RenameSheet open={dialog === 'rename'} onOpenChange={(v) => !v && setDialog(null)} title="Rename space" initial={space.name} onSave={(name) => patch({ name })} />
      <IconPicker open={dialog === 'icon'} onOpenChange={(v) => !v && setDialog(null)} current={space.icon} onSelect={(icon) => patch({ icon: icon ?? '' })} />
      {dialog === 'share' && <ShareSheet open onOpenChange={(v) => !v && setDialog(null)} type="space" id={space.id} name={space.name} />}
      <ConfirmSheet
        open={dialog === 'delete'}
        onOpenChange={(v) => !v && setDialog(null)}
        title="Delete space?"
        body={
          <>
            <b>{space.name}</b> and <b>everything in it</b> — pages, folders and files — will be permanently deleted. This can&apos;t be undone.
          </>
        }
        action="Delete space"
        onConfirm={async () => {
          await api(`/spaces/${space.id}`, { method: 'DELETE' });
          refresh();
          router.push('/spaces');
        }}
      />
    </>
  );
}
