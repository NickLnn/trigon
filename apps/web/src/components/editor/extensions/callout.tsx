'use client';

import { mergeAttributes, Node } from '@tiptap/core';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { Info, Lightbulb, OctagonAlert, TriangleAlert } from 'lucide-react';

export const CALLOUT_VARIANTS = ['info', 'warning', 'danger', 'tip'] as const;
export type CalloutVariant = (typeof CALLOUT_VARIANTS)[number];

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (variant?: CalloutVariant) => ReturnType;
    };
  }
}

const STYLE: Record<CalloutVariant, { Icon: typeof Info; label: string }> = {
  info: { Icon: Info, label: 'Info' },
  warning: { Icon: TriangleAlert, label: 'Warning' },
  danger: { Icon: OctagonAlert, label: 'Danger' },
  tip: { Icon: Lightbulb, label: 'Tip' },
};

function CalloutView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const variant = (node.attrs.variant as CalloutVariant) ?? 'info';
  const { Icon, label } = STYLE[variant] ?? STYLE.info;
  const cycle = () => {
    if (!editor.isEditable) return;
    const next = CALLOUT_VARIANTS[(CALLOUT_VARIANTS.indexOf(variant) + 1) % CALLOUT_VARIANTS.length];
    updateAttributes({ variant: next });
  };
  return (
    <NodeViewWrapper className="trigon-callout" data-callout={variant}>
      <button type="button" contentEditable={false} onClick={cycle} className="trigon-callout-icon" title={editor.isEditable ? `${label} — click to change` : label} aria-label={label}>
        <Icon className="size-[1.125rem]" />
      </button>
      <NodeViewContent className="trigon-callout-body" />
    </NodeViewWrapper>
  );
}

/** Info / warning / danger / tip boxes — the backbone of runbooks and KB articles. */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      variant: {
        default: 'info',
        parseHTML: (el) => (CALLOUT_VARIANTS as readonly string[]).includes(el.getAttribute('data-callout') ?? '') ? el.getAttribute('data-callout') : 'info',
        renderHTML: (attrs) => ({ 'data-callout': attrs.variant }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'trigon-callout' }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },

  addCommands() {
    return {
      setCallout:
        (variant = 'info') =>
        ({ commands }) =>
          commands.wrapIn(this.name, { variant }),
    };
  },
});
