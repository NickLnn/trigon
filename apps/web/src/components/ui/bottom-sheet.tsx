'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Drawer } from 'vaul';
import { useIsDesktop } from '@/lib/use-media';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  children: ReactNode;
}

/**
 * Phones get a native-feeling bottom sheet (drag to dismiss, background scales back — vaul).
 * Desktops get a centred dialog: a stretched bottom sheet looks wrong on a wide screen.
 */
export function BottomSheet({ open, onOpenChange, title, description, children }: Props) {
  const isDesktop = useIsDesktop();
  const describedBy = description ? {} : { 'aria-describedby': undefined };

  if (isDesktop) {
    return (
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay data-[state=open]:animate-[fade-in_160ms_ease-out]" />
          <Dialog.Content
            {...describedBy}
            className="fixed left-1/2 top-1/2 z-50 max-h-[85dvh] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-sheet bg-surface p-6 shadow-float outline-none data-[state=open]:animate-[dialog-in_200ms_var(--ease-spring)]"
          >
            <div className="flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <Dialog.Title className={title ? 'text-title font-bold' : 'sr-only'}>{title ?? 'Dialog'}</Dialog.Title>
                {description && <Dialog.Description className="mt-1 text-ink-2">{description}</Dialog.Description>}
              </div>
              <Dialog.Close className="press -mr-2 -mt-1 grid size-9 place-items-center rounded-full text-ink-3 hover:bg-surface-2" aria-label="Close">
                <X className="size-5" />
              </Dialog.Close>
            </div>
            <div className={title ? 'mt-5' : ''}>{children}</div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} shouldScaleBackground>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <Drawer.Content {...describedBy} className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-sheet bg-surface outline-none">
          <div className="mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-surface-3" />
          <div className="overflow-y-auto px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4">
            <Drawer.Title className={title ? 'text-title font-bold' : 'sr-only'}>{title ?? 'Sheet'}</Drawer.Title>
            {description && <Drawer.Description className="mt-1 text-ink-2">{description}</Drawer.Description>}
            <div className={title ? 'mt-5' : ''}>{children}</div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

/** A large tappable row used inside sheets (icon bubble + label + hint). */
export function SheetAction({
  icon,
  label,
  hint,
  onClick,
  tone = 'default',
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
  tone?: 'default' | 'danger';
}) {
  return (
    <button onClick={onClick} className="press flex w-full items-center gap-4 rounded-2xl p-3 text-left hover:bg-surface-2">
      <span className={`grid size-11 shrink-0 place-items-center rounded-full ${tone === 'danger' ? 'bg-danger/10 text-danger' : 'bg-accent-soft text-accent'}`}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className={`block font-semibold ${tone === 'danger' ? 'text-danger' : ''}`}>{label}</span>
        {hint && <span className="block text-meta text-ink-3">{hint}</span>}
      </span>
    </button>
  );
}
