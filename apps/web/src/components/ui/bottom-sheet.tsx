'use client';

import type { ReactNode } from 'react';
import { Drawer } from 'vaul';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  children: ReactNode;
}

/**
 * Native-feeling bottom sheet: drag to dismiss with velocity, rubber-banding, and the page behind
 * scaling back (vaul). On desktop it becomes a centred floating panel.
 */
export function BottomSheet({ open, onOpenChange, title, description, children }: Props) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} shouldScaleBackground>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <Drawer.Content
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-sheet bg-surface outline-none md:bottom-auto md:top-1/2 md:-translate-y-1/2 md:rounded-sheet md:shadow-float"
          {...(!description && { 'aria-describedby': undefined })}
        >
          <div className="mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-surface-3 md:hidden" />
          <div className="overflow-y-auto px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4">
            {title ? (
              <Drawer.Title className="text-title font-bold">{title}</Drawer.Title>
            ) : (
              <Drawer.Title className="sr-only">Sheet</Drawer.Title>
            )}
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
      <span
        className={`grid size-11 shrink-0 place-items-center rounded-full ${tone === 'danger' ? 'bg-danger/10 text-danger' : 'bg-accent-soft text-accent'}`}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className={`block font-semibold ${tone === 'danger' ? 'text-danger' : ''}`}>{label}</span>
        {hint && <span className="block text-meta text-ink-3">{hint}</span>}
      </span>
    </button>
  );
}
