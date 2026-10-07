import { common, createLowlight } from 'lowlight';

/** Shared lowlight instance: used for highlighting code blocks and for language detection. */
export const lowlight = createLowlight(common);

/** Languages we try when auto-detecting — a focused subset keeps detection fast and accurate. */
const DETECT_SUBSET = [
  'typescript',
  'javascript',
  'python',
  'java',
  'csharp',
  'cpp',
  'c',
  'go',
  'rust',
  'php',
  'ruby',
  'kotlin',
  'swift',
  'sql',
  'bash',
  'shell',
  'powershell',
  'json',
  'yaml',
  'xml',
  'css',
  'scss',
  'markdown',
  'ini',
  'dockerfile',
  'diff',
  'makefile',
];

const KEYWORD_LINE =
  /^\s*(import|export|from|const|let|var|function|def|class|interface|type|enum|public|private|protected|static|return|if|elif|else|for|foreach|while|switch|case|try|catch|finally|using|namespace|package|func|fn|impl|struct|async|await|#include|#define|SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|WITH|FROM|WHERE|echo|sudo|apt|npm|pnpm|yarn|docker|kubectl|git|cd|ls|curl|Get-|Set-|New-|\$\w+\s*=)\b/;
const SHELL_PROMPT = /^\s*(\$|>|PS [A-Z]:\\.*>)\s+\S/;
const LINE_END_CODE = /[;{}()[\]:,]\s*$|=>\s*$|\\\s*$/;
const OPERATORS = /(===|!==|==|!=|<=|>=|=>|->|::|\+\+|--|&&|\|\||<\/?\w+[^>]*>|\w+\(.*\)|\{\s*$|^\s*\}|\[\s*\]|:=)/;
const PROSE_SENTENCE = /^[A-Z][^{}<>;=]*[a-z][.!?]["')\]]?\s*$/;

export interface CodeSignal {
  isCode: boolean;
  score: number;
}

/**
 * Cheap structural classifier: does this pasted text look like source code rather than prose?
 * Scores each non-empty line for code-like features and penalises sentence-like lines.
 */
export function scoreCode(text: string): CodeSignal {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (!nonEmpty.length) return { isCode: false, score: 0 };

  let codeLines = 0;
  let proseLines = 0;
  let indented = 0;
  for (const line of nonEmpty) {
    let s = 0;
    if (KEYWORD_LINE.test(line)) s += 2;
    if (SHELL_PROMPT.test(line)) s += 2;
    if (LINE_END_CODE.test(line)) s += 1;
    if (OPERATORS.test(line)) s += 1;
    if (/^(\t| {2,})\S/.test(line)) indented++;
    if (PROSE_SENTENCE.test(line) && line.split(/\s+/).length > 5) s -= 2;
    if (s >= 2) codeLines++;
    else if (s < 0) proseLines++;
  }

  const symbols = (text.match(/[{}()[\];=<>$#@|&*\\/]/g) ?? []).length;
  const letters = (text.match(/[A-Za-z]/g) ?? []).length || 1;
  const symbolRatio = symbols / letters;

  const n = nonEmpty.length;
  let score = (codeLines - proseLines) / n;
  if (n > 2 && indented / n > 0.25) score += 0.2;
  if (symbolRatio > 0.08) score += 0.15;
  if (symbolRatio < 0.02) score -= 0.2;

  // A single line needs a much stronger signal (e.g. `npm install foo`, `SELECT * FROM t;`).
  const threshold = n === 1 ? 0.95 : 0.45;
  return { isCode: score >= threshold, score };
}

/** Best-guess highlight.js language name, or null when nothing is confident. */
export function detectLanguage(text: string): string | null {
  const trimmed = text.trim();
  if (/^[[{]/.test(trimmed)) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      /* not JSON — fall through */
    }
  }
  if (/^(#.*\n)*FROM\s+\S+/.test(trimmed) && /^(RUN|COPY|ADD|WORKDIR|CMD|ENTRYPOINT|ENV|EXPOSE)\s/m.test(trimmed)) {
    return 'dockerfile';
  }
  if (/^(diff --git|@@ .* @@|[+-]{3} [ab]\/)/m.test(trimmed)) return 'diff';
  if (SHELL_PROMPT.test(trimmed) || /^(sudo|apt|npm|pnpm|yarn|docker|kubectl|git|curl|cd|ls)\s/m.test(trimmed)) return 'bash';
  if (/^\s*(Get|Set|New|Remove|Invoke)-\w+/m.test(trimmed)) return 'powershell';

  const result = lowlight.highlightAuto(trimmed, { subset: DETECT_SUBSET });
  const language = result.data?.language;
  const relevance = result.data?.relevance ?? 0;
  return language && relevance >= 5 ? language : null;
}

/** Map VS Code's clipboard `mode` ids to highlight.js names. */
export function fromVsCodeMode(mode: string | undefined): string | null {
  if (!mode) return null;
  const map: Record<string, string> = {
    typescriptreact: 'typescript',
    javascriptreact: 'javascript',
    shellscript: 'bash',
    jsonc: 'json',
    plaintext: '',
    dockercompose: 'yaml',
  };
  const name = mode in map ? map[mode] : mode;
  return name && lowlight.registered(name) ? name : null;
}
