// Async upgrades applied after markdown is in the DOM: highlighted code, math, diagrams.
// Each heavy library is loaded only when a document actually uses it.

import { LanguageDescription, type LanguageSupport } from "@codemirror/language";
import { highlightCode } from "@lezer/highlight";
import { highlighter } from "../editor/highlight";
import { languages, loadLanguage } from "../editor/languages";

const cache = new Map<string, string>();

function remember(key: string, html: string): string {
  if (cache.size > 400) cache.delete(cache.keys().next().value!);
  cache.set(key, html);
  return html;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

async function highlighted(code: string, lang: string): Promise<string | null> {
  const key = `hl\u0000${lang}\u0000${code}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const desc = LanguageDescription.matchLanguageName(languages, lang, true);
  if (!desc) return null;
  const ext = (await loadLanguage(desc)) as LanguageSupport;
  if (!ext || !("language" in ext)) return null;
  const tree = ext.language.parser.parse(code);
  let html = "";
  highlightCode(
    code,
    tree,
    highlighter,
    (text, classes) => (html += classes ? `<span class="${classes}">${esc(text)}</span>` : esc(text)),
    () => (html += "\n"),
  );
  return remember(key, html);
}

let katexPromise: Promise<typeof import("katex").default> | null = null;
function katex() {
  katexPromise ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(([m]) => m.default);
  return katexPromise;
}

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
let mermaidDark: boolean | null = null;
let mermaidId = 0;
function mermaid(dark: boolean) {
  mermaidPromise ??= import("mermaid").then((m) => m.default);
  return mermaidPromise.then((m) => {
    if (mermaidDark !== dark) {
      m.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default", fontFamily: "inherit" });
      mermaidDark = dark;
    }
    return m;
  });
}

/** Matching elements inside `root`, including `root` itself. */
function select(root: ParentNode, selector: string): HTMLElement[] {
  const self = root instanceof HTMLElement && root.matches(selector) ? [root] : [];
  return [...self, ...root.querySelectorAll<HTMLElement>(selector)];
}

export async function enhance(root: ParentNode, dark: boolean): Promise<void> {
  const jobs: Promise<unknown>[] = [];

  for (const el of select(root, "code[data-lang]:not([data-done])")) {
    el.dataset.done = "1";
    const code = el.textContent ?? "";
    if (code.length > 200_000) continue;
    jobs.push(
      highlighted(code, el.dataset.lang!)
        .then((html) => {
          if (html !== null) el.innerHTML = html;
        })
        .catch(() => {}),
    );
  }

  const math = select(root, "[data-tex]:not([data-done])");
  if (math.length) {
    jobs.push(
      katex()
        .then((k) => {
          for (const el of math) {
            el.dataset.done = "1";
            const tex = decodeURIComponent(el.dataset.tex ?? "");
            const display = el.dataset.display === "1";
            const key = `tex\u0000${display}\u0000${tex}`;
            el.innerHTML = cache.get(key) ?? remember(key, k.renderToString(tex, { displayMode: display, throwOnError: false, output: "html" }));
          }
        })
        .catch(() => {}),
    );
  }

  const diagrams = select(root, ".mermaid-block:not([data-done])");
  if (diagrams.length) {
    jobs.push(
      mermaid(dark)
        .then(async (m) => {
          for (const el of diagrams) {
            el.dataset.done = "1";
            const src = decodeURIComponent(el.dataset.src ?? "");
            const key = `mm\u0000${dark}\u0000${src}`;
            const hit = cache.get(key);
            if (hit !== undefined) {
              el.innerHTML = hit;
              continue;
            }
            try {
              const { svg } = await m.render(`margin-mermaid-${++mermaidId}`, src);
              el.innerHTML = remember(key, svg);
            } catch (e) {
              el.innerHTML = `<pre class="diagram-error">${esc(e instanceof Error ? e.message : String(e))}</pre>`;
            }
          }
        })
        .catch(() => {}),
    );
  }

  await Promise.all(jobs);
}
