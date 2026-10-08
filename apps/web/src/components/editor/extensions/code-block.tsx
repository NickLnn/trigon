'use client';

import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { Check, Copy, TerminalSquare } from 'lucide-react';
import { useState } from 'react';
import { lowlight } from '@/lib/code-detect';

/** Friendly names for the shell/config languages people use most in IT docs. */
const LABELS: Record<string, string> = {
  powershell: 'PowerShell',
  bash: 'Bash',
  shell: 'Shell',
  dos: 'CMD',
  yaml: 'YAML',
  json: 'JSON',
  sql: 'SQL',
  python: 'Python',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  xml: 'XML / HTML',
  ini: 'INI / conf',
  dockerfile: 'Dockerfile',
  nginx: 'Nginx',
  csharp: 'C#',
  go: 'Go',
  plaintext: 'Plain text',
};
const COMMON = ['powershell', 'bash', 'dos', 'yaml', 'json', 'sql', 'python', 'xml', 'ini', 'dockerfile', 'nginx', 'javascript', 'typescript', 'csharp', 'go'];

function CodeBlockView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const [copied, setCopied] = useState(false);
  const language: string | null = node.attrs.language;
  const options = Array.from(new Set([...COMMON, ...(language ? [language] : [])])).filter((l) => l === 'plaintext' || lowlight.registered(l));

  const copy = async () => {
    await navigator.clipboard.writeText(node.textContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <NodeViewWrapper className="trigon-code">
      <div className="trigon-code-bar" contentEditable={false}>
        <TerminalSquare className="size-3.5" />
        {editor.isEditable ? (
          <select value={language ?? ''} onChange={(e) => updateAttributes({ language: e.target.value || null })} className="trigon-code-lang" aria-label="Language">
            <option value="">Auto-detect</option>
            {options.map((l) => (
              <option key={l} value={l}>
                {LABELS[l] ?? l}
              </option>
            ))}
          </select>
        ) : (
          <span>{language ? (LABELS[language] ?? language) : 'Code'}</span>
        )}
        <button type="button" onClick={copy} className="trigon-code-copy">
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>
        <NodeViewContent<'code'> as="code" />
      </pre>
    </NodeViewWrapper>
  );
}

/** Syntax-highlighted code block with a language picker and one-click copy. */
export const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
}).configure({ lowlight, defaultLanguage: null });
