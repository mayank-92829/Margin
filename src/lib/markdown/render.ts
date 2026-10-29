import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";
import type { Env, StateBlock, StateCore, StateInline } from "markdown-it";

export interface RenderEnv extends Env {
  math: boolean;
  diagrams: boolean;
}

const md = new MarkdownIt({ html: true, linkify: true, typographer: false, breaks: false });
const esc = md.utils.escapeHtml;

// Source line numbers on every block, for scroll sync and clickable checkboxes.
md.core.ruler.push("source_lines", (state: StateCore) => {
  for (const tok of state.tokens) {
    if (tok.map && tok.block && tok.nesting !== -1) tok.attrSet("data-line", String(tok.map[0]));
  }
});

// GitHub-style task lists: "- [ ] todo" / "- [x] done".
md.core.ruler.push("task_lists", (state: StateCore) => {
  const t = state.tokens;
  for (let i = 2; i < t.length; i++) {
    if (t[i].type !== "inline" || t[i - 1].type !== "paragraph_open" || t[i - 2].type !== "list_item_open") continue;
    const m = /^\[([ xX])\](?:[ \t]|$)/.exec(t[i].content);
    const first = t[i].children?.[0];
    if (!m || !first || first.type !== "text" || !first.content.startsWith(m[0].slice(0, 3))) continue;
    first.content = first.content.slice(3).replace(/^[ \t]/, "");
    const box = new state.Token("html_inline", "", 0);
    const line = t[i - 1].map?.[0] ?? 0;
    box.content = `<input type="checkbox" class="task" data-task="${line}"${m[1] !== " " ? " checked" : ""}>`;
    t[i].children!.unshift(box);
    t[i - 2].attrJoin("class", "task-item");
  }
});

// Heading anchors, so [links](#section) work.
md.core.ruler.push("heading_ids", (state: StateCore) => {
  const used = new Map<string, number>();
  const t = state.tokens;
  for (let i = 0; i < t.length - 1; i++) {
    if (t[i].type !== "heading_open") continue;
    const text = (t[i + 1].children ?? []).filter((c) => c.type === "text" || c.type === "code_inline").map((c) => c.content).join("");
    let slug = text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s+/g, "-") || "section";
    const n = used.get(slug) ?? 0;
    used.set(slug, n + 1);
    if (n) slug += `-${n}`;
    t[i].attrSet("id", slug);
  }
});

function mathInline(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const pos = state.pos;
  if (src.charCodeAt(pos) !== 0x24) return false;
  const display = src.charCodeAt(pos + 1) === 0x24;
  const open = display ? 2 : 1;
  const start = pos + open;
  if (!display && /[\s]/.test(src[start] ?? " ")) return false;
  let end = start;
  for (;;) {
    end = src.indexOf(display ? "$$" : "$", end);
    if (end < 0) return false;
    if (src.charCodeAt(end - 1) === 0x5c) {
      end++;
      continue;
    }
    break;
  }
  if (end === start) return false;
  // "$5 and $10" is money, not math.
  if (!display && (/\s/.test(src[end - 1]) || /[0-9]/.test(src[end + 1] ?? ""))) return false;
  if (!silent) {
    const tok = state.push("math_inline", "span", 0);
    tok.content = src.slice(start, end);
    tok.meta = { display };
  }
  state.pos = end + open;
  return true;
}

function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  let pos = state.bMarks[startLine] + state.tShift[startLine];
  let max = state.eMarks[startLine];
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  if (state.src.slice(pos, pos + 2) !== "$$") return false;
  const first = state.src.slice(pos + 2, max).trim();
  let next = startLine;
  let content: string;
  if (first.length >= 2 && first.endsWith("$$")) {
    content = first.slice(0, -2);
  } else {
    const lines = [first];
    let found = false;
    while (++next < endLine) {
      pos = state.bMarks[next] + state.tShift[next];
      max = state.eMarks[next];
      if (pos < max && state.sCount[next] < state.blkIndent) break;
      const text = state.src.slice(pos, max).trim();
      if (text.endsWith("$$")) {
        lines.push(text.slice(0, -2));
        found = true;
        break;
      }
      lines.push(state.src.slice(pos, max));
    }
    if (!found) return false;
    content = lines.join("\n");
  }
  if (silent) return true;
  state.line = next + 1;
  const tok = state.push("math_block", "div", 0);
  tok.block = true;
  tok.content = content;
  tok.map = [startLine, state.line];
  return true;
}

md.inline.ruler.after("escape", "math_inline", mathInline);
md.block.ruler.before("fence", "math_block", mathBlock, { alt: ["paragraph", "reference", "blockquote", "list"] });

md.renderer.rules.math_inline = (tokens, idx, _o, env?: Env) => {
  const tok = tokens[idx];
  const d = tok.meta?.display;
  if (!env?.math) return esc(d ? `$$${tok.content}$$` : `$${tok.content}$`);
  return `<span class="math" data-tex="${encodeURIComponent(tok.content)}"${d ? ' data-display="1"' : ""}></span>`;
};

md.renderer.rules.math_block = (tokens, idx, _o, env?: Env) => {
  const tok = tokens[idx];
  const line = tok.attrGet("data-line") ?? "";
  if (!env?.math) return `<p data-line="${line}">${esc(`$$${tok.content}$$`)}</p>\n`;
  return `<div class="math-block" data-line="${line}" data-tex="${encodeURIComponent(tok.content)}" data-display="1"></div>\n`;
};

md.renderer.rules.fence = (tokens, idx, _o, env?: Env) => {
  const tok = tokens[idx];
  const lang = tok.info.trim().split(/\s+/)[0].toLowerCase();
  const line = tok.attrGet("data-line") ?? "";
  if (lang === "mermaid" && env?.diagrams) return `<div class="mermaid-block" data-line="${line}" data-src="${encodeURIComponent(tok.content)}"></div>\n`;
  if ((lang === "math" || lang === "latex" || lang === "katex") && env?.math) {
    return `<div class="math-block" data-line="${line}" data-tex="${encodeURIComponent(tok.content)}" data-display="1"></div>\n`;
  }
  const attrs = lang ? ` class="language-${esc(lang)}" data-lang="${esc(lang)}"` : "";
  return `<pre data-line="${line}"><code${attrs}>${esc(tok.content)}</code></pre>\n`;
};

// Wide tables scroll sideways instead of overflowing the page.
md.renderer.rules.table_open = (tokens, idx, options, _env, self) => `<div class="table-wrap">${self.renderToken(tokens, idx, options)}`;
md.renderer.rules.table_close = (tokens, idx, options, _env, self) => `${self.renderToken(tokens, idx, options)}</div>`;

const purifyConfig = {
  FORBID_TAGS: ["style", "form", "base", "meta", "link"],
  FORBID_ATTR: ["srcset"],
  ADD_ATTR: ["target"],
};

/** Markdown → sanitized HTML. Scripts and event handlers never make it through. */
export function renderMarkdown(src: string, env: RenderEnv): string {
  return DOMPurify.sanitize(md.render(src, env), purifyConfig) as string;
}
