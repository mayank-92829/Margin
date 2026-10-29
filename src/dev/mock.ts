// Browser-only test harness: an in-memory stand-in for the Rust backend.
// Loaded by dev.html; never part of the real app.

import { emit } from "@tauri-apps/api/event";
import { mockConvertFileSrc, mockIPC, mockWindows } from "@tauri-apps/api/mocks";

const DIR = "C:\\Users\\demo\\Documents";

const README = `# Margin test document

A paragraph with **bold**, *italic*, \`inline code\`, ~~strike~~ and a [link](https://example.com).
Jump to [the table](#a-table).

## Tasks

- [ ] write the editor
- [x] make it fast
- [ ] ship it

## A table

| Feature | Status |
| ------- | :----: |
| Tabs    | ✓      |
| Themes  | ✓      |

## Code

\`\`\`js
function greet(name) {
  // say hello
  return \`Hello, \${name}!\`;
}
\`\`\`

## Math

Inline $E = mc^2$ costs $5 and $10 is money, not math.

$$
\\int_0^1 x^2 \\, dx = \\frac{1}{3}
$$

## Diagram

\`\`\`mermaid
graph LR
  A[Open] --> B{Markdown?}
  B -->|yes| C[Preview]
  B -->|no| D[Editor]
\`\`\`

> A quote, for good measure.

<script>window.__xss = true</script>
<img src="x" onerror="window.__xss2 = true">
`;

const NOTES = "Shopping list\r\n\r\n- milk\r\n- eggs\r\n- coffee\r\n\r\nCall mom on Sunday.\r\n";

const APP_JS = `import { readFile } from "node:fs/promises";

export async function load(path) {
\tconst text = await readFile(path, "utf8");
\treturn text.split("\\n").filter(Boolean);
}
`;

const HELLO_C = `#include <stdio.h>

int main(void) {
    char name[64];
    printf("What's your name? ");
    scanf("%63s", name);
    printf("Hello, %s!\\n", name);
    return 0
}
`;

interface MockFile {
  content: string;
  mtime: number;
  virtualLines?: number;
}

const files = new Map<string, MockFile>([
  [`${DIR}\\README.md`, { content: README, mtime: 1 }],
  [`${DIR}\\notes.txt`, { content: NOTES, mtime: 1 }],
  [`${DIR}\\app.js`, { content: APP_JS, mtime: 1 }],
  [`${DIR}\\code\\hello.c`, { content: HELLO_C, mtime: 1 }],
  [`${DIR}\\code\\notes\\todo.txt`, { content: "- learn pointers\r\n", mtime: 1 }],
  [`${DIR}\\server.log`, { content: "", mtime: 1, virtualLines: 2_000_000 }],
]);

const logLine = (i: number) => `2026-10-29T12:${String(Math.floor(i / 60) % 60).padStart(2, "0")}:${String(i % 60).padStart(2, "0")} INFO request id=${i} path=/api/items/${i % 977} status=${i % 1013 === 0 ? 500 : 200}`;

const backups = new Map<string, string>();
const running = new Map<number, (text: string) => void>();
const store = { settings: null as string | null, session: null as string | null, themes: new Map<string, string>() };
const pending = [`${DIR}\\README.md`, `${DIR}\\notes.txt`];
const log: { cmd: string; args: unknown }[] = [];

const key = (p: string) => p.toLowerCase();
function find(p: string) {
  for (const [k, v] of files) if (key(k) === key(p)) return { path: k, file: v };
  return null;
}
const sizeOf = (f: MockFile) => (f.virtualLines ? f.virtualLines * 80 : new TextEncoder().encode(f.content).length);
const stat = (f: MockFile) => ({ size: sizeOf(f), mtime: f.mtime, readonly: false });

function eolOf(s: string): string {
  const crlf = (s.match(/\r\n/g) ?? []).length;
  const lf = (s.match(/(?<!\r)\n/g) ?? []).length;
  return !crlf && !lf ? "" : crlf >= lf ? "CRLF" : "LF";
}

type Args = Record<string, any>;

const handlers: Record<string, (a: Args) => unknown> = {
  read_text_file: ({ path, maxBytes }) => {
    const hit = find(path);
    if (!hit) throw `NOTFOUND:"${path.split("\\").pop()}" doesn't exist.`;
    const f = hit.file;
    const base = { path: hit.path, encoding: "UTF-8", bom: false, mixedEol: false, binary: false, lossy: false, stat: stat(f) };
    if (sizeOf(f) > maxBytes) return { ...base, content: null, eol: "" };
    return { ...base, content: f.content, eol: eolOf(f.content) };
  },
  write_text_file: ({ path, content, eol }) => {
    const text = eol === "CRLF" ? content.replace(/\n/g, "\r\n") : content;
    const existing = find(path);
    const f = { content: text, mtime: Date.now() };
    files.set(existing?.path ?? path, f);
    return stat(f);
  },
  stat_files: ({ paths }) => paths.map((p: string) => {
    const hit = find(p);
    return hit ? stat(hit.file) : null;
  }),
  save_settings: ({ text }) => {
    store.settings = text;
    files.set("C:\\Users\\demo\\AppData\\Roaming\\com.margin.editor\\settings.json", { content: text, mtime: Date.now() });
  },
  save_session: ({ text }) => void (store.session = text),
  write_backup: ({ id, content }) => void backups.set(id, content),
  read_backup: ({ id }) => backups.get(id) ?? null,
  prune_backups: ({ keep }) => {
    for (const k of [...backups.keys()]) if (!keep.includes(k)) backups.delete(k);
  },
  list_themes: () => [...store.themes].map(([file, text]) => ({ file, text })),
  save_theme: ({ name, text }) => {
    const p = `C:\\Users\\demo\\AppData\\Roaming\\com.margin.editor\\themes\\${name}.json`;
    store.themes.set(p, text);
    files.set(p, { content: text, mtime: Date.now() });
    return p;
  },
  set_window_bg: () => null,
  take_pending_files: () => pending.splice(0),
  app_ready: () => null,
  large_open: ({ path }) => ({ id: 7, size: sizeOf(find(path)!.file), encoding: "UTF-8" }),
  large_status: () => ({ lines: 2_000_000, bytesIndexed: 160_000_000, size: 160_000_000, done: true, error: null }),
  large_lines: ({ start, count }) => Array.from({ length: Math.max(0, Math.min(count, 2_000_000 - start)) }, (_, i) => logLine(start + i)),
  large_search: ({ query, fromLine, fromByte, backward }) => {
    const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    for (let n = 0; n < 2_000_000; n++) {
      const line = backward ? fromLine - n : fromLine + n;
      if (line < 0 || line >= 2_000_000) break;
      const text = logLine(line);
      const startAt = n === 0 && !backward ? fromByte : 0;
      const m = re.exec(text.slice(startAt));
      if (m && !(n === 0 && backward && startAt + m.index >= fromByte)) {
        const s = startAt + m.index;
        return { line, byteStart: s, byteEnd: s + m[0].length, colStart: s, colEnd: s + m[0].length, wrapped: false };
      }
    }
    return null;
  },
  large_close: () => null,
  list_dir: ({ path }) => {
    const prefix = path.replace(/\\$/, "") + "\\";
    const seen = new Map<string, boolean>();
    for (const k of files.keys()) {
      if (!key(k).startsWith(key(prefix))) continue;
      const rest = k.slice(prefix.length).split("\\");
      seen.set(rest[0], rest.length > 1 || seen.get(rest[0]) === true);
    }
    if (!seen.size && !find(path)) throw `NOTFOUND:"${path}" doesn't exist.`;
    return [...seen].map(([name, dir]) => ({ name, dir })).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
  },
  is_dir: ({ path }) => !find(path) && [...files.keys()].some((k) => key(k).startsWith(key(path.replace(/\\$/, "") + "\\"))),
  run_start: ({ id, argv }) => {
    const out = (text: string, err = false, ms = 0) => setTimeout(() => emit("run-output", { id, err, text }), ms);
    const exit = (code: number, ms: number) => setTimeout(() => emit("run-exit", { id, code, ms }), ms);
    const program = String(argv[0]).toLowerCase();
    if (program === "gcc" || program === "g++") {
      const src = find(argv[1])?.file.content ?? "";
      if (/return 0\s*\n\s*}/.test(src)) {
        const f = argv[1];
        out(`${f}: In function 'main':\n${f}:8:13: error: expected ';' before '}' token\n    8 |     return 0\n      |             ^\n      |             ;\n`, true, 300);
        exit(1, 320);
      } else exit(0, 400);
    } else if (program.endsWith(".exe")) {
      running.set(id, (text) => {
        out(`Hello, ${text.trim()}!\n`);
        exit(0, 10);
      });
      out("What's your name? ", false, 50);
    } else {
      out(`'${argv[0]}' isn't available in the browser harness.\n`, true);
      exit(1, 10);
    }
    return null;
  },
  run_input: ({ id, text }) => void running.get(id)?.(text),
  run_kill: ({ id }) => {
    running.delete(id);
    setTimeout(() => emit("run-exit", { id, code: null, ms: 1 }), 5);
  },
  run_in_console: () => null,
  "plugin:dialog|open": () => `${DIR}\\app.js`,
  "plugin:dialog|save": ({ options }) => options?.defaultPath ?? `${DIR}\\Untitled.txt`,
  "plugin:window|is_maximized": () => false,
  "plugin:window|is_fullscreen": () => false,
  "plugin:window|is_minimized": () => false,
};

mockWindows("main");
mockConvertFileSrc("windows");
mockIPC(
  (cmd, args) => {
    log.push({ cmd, args });
    const h = handlers[cmd];
    if (h) return h((args ?? {}) as Args);
    return null;
  },
  { shouldMockEvents: true },
);

// Survive page reloads, so "restart the app" can be tested.
const saved = sessionStorage.getItem("margin-mock");
if (saved) {
  const s = JSON.parse(saved);
  files.clear();
  for (const [k, v] of s.files) files.set(k, v);
  for (const [k, v] of s.backups) backups.set(k, v);
  store.settings = s.settings;
  store.session = s.session;
  pending.length = 0;
}
window.addEventListener("pagehide", () => {
  sessionStorage.setItem(
    "margin-mock",
    JSON.stringify({ files: [...files], backups: [...backups], settings: store.settings, session: store.session }),
  );
});

window.__MARGIN_BOOT__ = {
  settingsText: store.settings,
  sessionText: store.session,
  customThemes: [],
  paths: {
    settings: "C:\\Users\\demo\\AppData\\Roaming\\com.margin.editor\\settings.json",
    themes: "C:\\Users\\demo\\AppData\\Roaming\\com.margin.editor\\themes",
    config: "C:\\Users\\demo\\AppData\\Roaming\\com.margin.editor",
  },
  version: "1.0.0-dev",
};

Object.assign(window, { __mock: { files, backups, store, log, pending } });
