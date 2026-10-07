'use client';

import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { useQueryClient } from '@tanstack/react-query';
import { githubDark, githubLight } from '@uiw/codemirror-theme-github';
import CodeMirror, { EditorView, type Extension } from '@uiw/react-codemirror';
import { Check, Loader2, Save } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api, apiBlob } from '@/lib/api';
import { useMediaQuery } from '@/lib/use-media';

function useDarkMode() {
  const system = useMediaQuery('(prefers-color-scheme: dark)');
  const [forced, setForced] = useState<string | undefined>();
  useEffect(() => {
    const read = () => setForced(document.documentElement.dataset.theme);
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  return forced ? forced === 'dark' : !!system;
}

/**
 * Editable text/code files (YAML, JSON, PowerShell, Bash, Python, configs…) with syntax highlighting
 * picked from the file name. Ctrl/⌘+S saves; read-only for viewers.
 */
export function CodeFileEditor({ documentId, fileName, editable }: { documentId: string; fileName: string; editable: boolean }) {
  const qc = useQueryClient();
  const dark = useDarkMode();
  const [original, setOriginal] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [language, setLanguage] = useState<Extension | null>(null);
  const [languageName, setLanguageName] = useState<string>('Plain text');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const dirty = original !== null && value !== original;

  useEffect(() => {
    let cancelled = false;
    apiBlob(`/files/${documentId}/content`)
      .then((b) => b.text())
      .then((text) => {
        if (cancelled) return;
        setOriginal(text);
        setValue(text);
      })
      .catch((err) => !cancelled && setError(err.message));
    const desc = LanguageDescription.matchFilename(languages, fileName) ?? (fileName.toLowerCase().endsWith('.ps1') ? LanguageDescription.matchLanguageName(languages, 'powershell') : null);
    if (desc) {
      setLanguageName(desc.name);
      desc.load().then((support) => !cancelled && setLanguage(support));
    }
    return () => {
      cancelled = true;
    };
  }, [documentId, fileName]);

  const save = useCallback(async () => {
    if (!editable || !dirty) return;
    setStatus('saving');
    try {
      await api(`/files/${documentId}/content`, { method: 'PUT', json: { content: value } });
      setOriginal(value);
      setStatus('saved');
      qc.invalidateQueries({ queryKey: ['recent'] });
      setTimeout(() => setStatus('idle'), 1500);
    } catch (err) {
      setError((err as Error).message);
      setStatus('error');
    }
  }, [editable, dirty, documentId, value, qc]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [dirty]);

  if (error && original === null) return <p className="p-6 text-center text-danger">{error}</p>;
  if (original === null) return <div className="m-4 h-64 animate-pulse rounded-xl bg-surface-2" />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-4 py-2 text-sm">
        <span className="rounded-md bg-surface-2 px-2 py-0.5 text-meta font-semibold text-ink-2">{languageName}</span>
        {!editable && <span className="text-meta text-ink-3">View only</span>}
        <span className="flex-1" />
        {status === 'error' && <span className="text-meta text-danger">{error}</span>}
        {editable && (
          <button
            onClick={save}
            disabled={!dirty || status === 'saving'}
            className="press inline-flex items-center gap-1.5 rounded-pill bg-accent px-3.5 py-1.5 text-sm font-semibold text-accent-ink disabled:bg-surface-2 disabled:text-ink-3"
            title="Save (Ctrl+S)"
          >
            {status === 'saving' ? <Loader2 className="size-4 animate-spin" /> : status === 'saved' ? <Check className="size-4" /> : <Save className="size-4" />}
            {status === 'saved' ? 'Saved' : dirty ? 'Save' : 'Saved'}
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <CodeMirror
          value={value}
          onChange={setValue}
          editable={editable}
          readOnly={!editable}
          theme={dark ? githubDark : githubLight}
          extensions={[...(language ? [language] : []), EditorView.lineWrapping]}
          basicSetup={{ highlightActiveLine: editable, foldGutter: true, bracketMatching: true, autocompletion: false }}
          className="h-full text-[0.8125rem] [&_.cm-editor]:min-h-full [&_.cm-scroller]:font-mono"
          height="100%"
        />
      </div>
    </div>
  );
}
