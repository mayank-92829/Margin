import { listen } from "@tauri-apps/api/event";
import { boot } from "./boot";
import { ipc, parseError } from "./ipc";
import { basename, dirname, extname, resolvePath } from "./path";
import { serializeSettings, settings, settingsMeta } from "./settings.svelte";
import { activeTab, openFile, saveTab, selectLine, type Tab } from "./tabs.svelte";
import { toast } from "./ui.svelte";

/**
 * How to build and run a file. Commands are templates: ${file} (full path), ${dir}, ${name}
 * (file name without extension), ${base} (file name) and ${exe} (${dir}\${name}.exe).
 */
export interface Runner {
  compile?: string;
  run: string;
}

const C = { compile: 'gcc "${file}" -o "${exe}" -Wall -g', run: '"${exe}"' };
const CPP = { compile: 'g++ "${file}" -o "${exe}" -Wall -g', run: '"${exe}"' };
const JS = { compile: 'node --check "${file}"', run: 'node "${file}"' };

export const DEFAULT_RUNNERS: Record<string, Runner> = {
  c: C,
  cpp: CPP, cc: CPP, cxx: CPP, "c++": CPP,
  rs: { compile: 'rustc "${file}" -o "${exe}" -g', run: '"${exe}"' },
  go: { compile: 'go build -o "${exe}" "${file}"', run: '"${exe}"' },
  java: { compile: 'javac "${file}"', run: 'java -cp "${dir}" "${name}"' },
  py: { compile: 'python -m py_compile "${file}"', run: 'python -u "${file}"' },
  pyw: { run: 'python -u "${file}"' },
  js: JS, mjs: JS, cjs: JS,
  ts: { run: 'npx --yes tsx "${file}"' },
  rb: { compile: 'ruby -c "${file}"', run: 'ruby "${file}"' },
  lua: { run: 'lua "${file}"' },
  php: { compile: 'php -l "${file}"', run: 'php "${file}"' },
  pl: { compile: 'perl -c "${file}"', run: 'perl "${file}"' },
  dart: { run: 'dart run "${file}"' },
  sh: { run: 'bash "${file}"' },
  ps1: { run: 'powershell -NoProfile -ExecutionPolicy Bypass -File "${file}"' },
  bat: { run: 'cmd /d /c "${file}"' },
  cmd: { run: 'cmd /d /c "${file}"' },
};

export function runnerFor(path: string | null): Runner | null {
  if (!path) return null;
  const ext = extname(path);
  const custom = settings.runners[ext];
  const base = DEFAULT_RUNNERS[ext];
  if (custom) return { compile: "compile" in custom ? custom.compile || undefined : base?.compile, run: custom.run ?? base?.run ?? "" };
  return base ?? null;
}

/** Splits a command template into arguments (double quotes group), then fills in the variables. */
export function expand(template: string, vars: Record<string, string>): string[] {
  const args: string[] = [];
  let cur = "";
  let quoted = false;
  let started = false;
  for (const ch of template) {
    if (ch === '"') {
      quoted = !quoted;
      started = true;
    } else if (!quoted && /\s/.test(ch)) {
      if (started) args.push(cur);
      cur = "";
      started = false;
    } else {
      cur += ch;
      started = true;
    }
  }
  if (started) args.push(cur);
  return args.map((a) => a.replace(/\$\{(\w+)\}/g, (m, k: string) => vars[k] ?? m));
}

// ---------------------------------------------------------------- output panel state

export interface Chunk {
  text: string;
  kind: "out" | "err" | "info" | "input" | "ok" | "fail";
}

export const run = $state({
  open: false,
  height: 220,
  phase: "idle" as "idle" | "compiling" | "running" | "done" | "failed" | "stopped",
  status: "",
  /** Folder that relative paths in the output are resolved against. */
  cwd: "",
  /** True while a program is running and reading its input. */
  acceptsInput: false,
});

/** Output is kept outside Svelte's deep reactivity; `version` tells the panel to redraw. */
export const output = $state({ chunks: [] as Chunk[], version: 0 });

const MAX_CHARS = 400_000;
let total = 0;
let pending: Chunk[] = [];
let frame = 0;

function flush(): void {
  frame = 0;
  const list = output.chunks;
  for (const c of pending) {
    const last = list[list.length - 1];
    if (last && last.kind === c.kind && (c.kind === "out" || c.kind === "err")) last.text += c.text;
    else list.push({ ...c });
    total += c.text.length;
  }
  pending = [];
  while (total > MAX_CHARS && list.length > 1) total -= list.shift()!.text.length;
  output.version++;
}

function emit(text: string, kind: Chunk["kind"]): void {
  // Programs may print terminal color codes; the panel shows plain text.
  pending.push({ text: text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ""), kind });
  if (!frame) frame = requestAnimationFrame(flush);
}

export function clearOutput(): void {
  cancelAnimationFrame(frame);
  frame = 0;
  pending = [];
  total = 0;
  output.chunks = [];
  output.version++;
}

// ---------------------------------------------------------------- processes

let nextId = 1;
let currentId = 0;
let generation = 0;
const exits = new Map<number, (code: number | null) => void>();

let listening: Promise<unknown> | null = null;

function ensureListening(): Promise<unknown> {
  listening ??= Promise.all([
    listen<{ id: number; err: boolean; text: string }>("run-output", (e) => {
      if (e.payload.id === currentId) emit(e.payload.text, e.payload.err ? "err" : "out");
    }),
    listen<{ id: number; code: number | null; ms: number }>("run-exit", (e) => {
      exits.get(e.payload.id)?.(e.payload.code);
      exits.delete(e.payload.id);
    }),
  ]);
  return listening;
}

async function step(argv: string[], cwd: string, unbuffer: boolean): Promise<{ code: number | null; ms: number }> {
  await ensureListening();
  const id = nextId++;
  currentId = id;
  const started = performance.now();
  const done = new Promise<number | null>((resolve) => exits.set(id, resolve));
  try {
    await ipc.runStart(id, argv, cwd, unbuffer);
  } catch (e) {
    exits.delete(id);
    throw e;
  }
  const code = await done;
  return { code, ms: performance.now() - started };
}

function commandLine(argv: string[]): string {
  return argv.map((a) => (/[\s"]/.test(a) ? `"${a}"` : a)).join(" ");
}

function seconds(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

const CRASHES: Record<number, string> = {
  0xc0000005: "access violation — reading or writing memory it doesn't own",
  0xc00000fd: "stack overflow",
  0xc0000094: "integer division by zero",
  0xc000008e: "floating-point division by zero",
  0xc0000409: "aborted (stack buffer overrun or failed check)",
  0xc000013a: "stopped with Ctrl+C",
  0xc0000135: "a DLL it needs wasn't found",
};

function exitText(code: number | null): string {
  if (code === null) return "Stopped";
  const u = code >>> 0;
  if (CRASHES[u]) return `Crashed: ${CRASHES[u]} (0x${u.toString(16).toUpperCase()})`;
  return `Exited with code ${code}`;
}

/** Finds the Cargo project a Rust file belongs to, if any. */
async function cargoRoot(path: string): Promise<string | null> {
  let dir = dirname(path);
  for (let i = 0; i < 6; i++) {
    const [stat] = await ipc.statFiles([dir + "\\Cargo.toml"]).catch(() => [null]);
    if (stat) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

async function prepare(tab: Tab): Promise<boolean> {
  if (!tab.path) {
    toast("Save the file first (with an extension like .c, .cpp, .py) so Margin knows how to run it.");
    return saveTab(tab, true);
  }
  if (tab.dirty || tab.metaDirty) return saveTab(tab);
  return true;
}

export function isRunning(): boolean {
  return run.phase === "compiling" || run.phase === "running";
}

/** Compiles the active file and, with `andRun`, runs the result. */
export async function build(andRun: boolean): Promise<void> {
  const tab = activeTab();
  if (!tab || tab.kind !== "text") return;
  if (!(await prepare(tab)) || !tab.path) return;
  const path = tab.path;
  const ext = extname(path);
  let runner = runnerFor(path);
  let cwd = dirname(path);
  if (ext === "rs" && !settings.runners.rs) {
    const root = await cargoRoot(path);
    if (root) {
      runner = { compile: "cargo build", run: "cargo run -q" };
      cwd = root;
    }
  }
  if (!runner?.run) {
    toast(`Margin doesn't know how to run .${ext || "untitled"} files. Add a command under "runners" in settings.json.`, {
      action: {
        label: "Open settings",
        run: async () => {
          if (!settingsMeta.error) await ipc.saveSettings(serializeSettings());
          await openFile(boot.paths.settings);
        },
      },
    });
    return;
  }
  if (isRunning()) await stop();
  const gen = ++generation;
  const name = basename(path).replace(/\.[^.]+$/, "");
  const vars = { file: path, dir: dirname(path), name, base: basename(path), exe: `${dirname(path)}\\${name}.exe` };
  clearOutput();
  run.open = true;
  run.cwd = cwd;
  const external = andRun && settings.runInTerminal;

  try {
    if (runner.compile) {
      const argv = expand(runner.compile, vars);
      run.phase = "compiling";
      run.status = andRun ? "Compiling…" : `Compiling ${basename(path)}…`;
      emit(`> ${commandLine(argv)}\n`, "info");
      const { code, ms } = await step(argv, cwd, andRun && !external);
      if (gen !== generation) return;
      if (code !== 0) {
        run.phase = code === null ? "stopped" : "failed";
        run.status = code === null ? "Stopped" : "Compilation failed";
        emit(`\n${code === null ? "Stopped" : `Compilation failed (exit code ${code})`}\n`, "fail");
        return;
      }
      if (!andRun) {
        run.phase = "done";
        run.status = `Compiled in ${seconds(ms)}`;
        emit(`Compiled successfully in ${seconds(ms)}\n`, "ok");
        return;
      }
    } else if (!andRun) {
      run.phase = "done";
      run.status = "Nothing to compile";
      emit(`.${ext} files run directly — use Run (F5).\n`, "info");
      return;
    }

    const argv = expand(runner.run, vars);
    if (external) {
      await ipc.runInConsole(argv, cwd, basename(path));
      run.phase = "done";
      run.status = "Running in a console window";
      emit(`> ${commandLine(argv)}\nStarted in a separate console window.\n`, "info");
      return;
    }
    run.phase = "running";
    run.status = `Running ${basename(path)}…`;
    run.acceptsInput = true;
    emit(`> ${commandLine(argv)}\n`, "info");
    const { code, ms } = await step(argv, cwd, false);
    if (gen !== generation) return;
    run.acceptsInput = false;
    run.phase = code === 0 ? "done" : code === null ? "stopped" : "failed";
    run.status = `${exitText(code)} · ${seconds(ms)}`;
    const ends = output.chunks.at(-1)?.text.endsWith("\n") ?? true;
    emit(`${ends ? "" : "\n"}\n${run.status}\n`, code === 0 ? "ok" : "fail");
  } catch (e) {
    if (gen !== generation) return;
    run.acceptsInput = false;
    run.phase = "failed";
    run.status = "Couldn't start";
    emit(parseError(e).message + "\n", "fail");
  }
}

export async function stop(): Promise<void> {
  if (!isRunning()) return;
  const id = currentId;
  run.acceptsInput = false;
  await ipc.runKill(id).catch(() => {});
}

/** Sends a line typed in the panel to the running program. */
export async function sendInput(text: string): Promise<void> {
  if (!run.acceptsInput) return;
  emit(text + "\n", "input");
  await ipc.runInput(currentId, text + "\n").catch(() => {});
}

/** Ends the program's input (like Ctrl+Z, Enter in a console). */
export async function endInput(): Promise<void> {
  if (!run.acceptsInput) return;
  emit("^Z\n", "input");
  await ipc.runInput(currentId, "", true).catch(() => {});
}

export function toggleOutput(): void {
  run.open = !run.open;
}

// ---------------------------------------------------------------- clickable locations in the output

// gcc/clang/rustc/go/javac style "path:line[:col]", and Python's 'File "path", line N'.
const LOCATION = /(File "([^"]+)", line (\d+))|((?:[A-Za-z]:[\\/][^:*?"<>|\r\n]*?|[\w.\-\\/]*?)[\w\-]+\.[A-Za-z][\w+]*):(\d+)(?::(\d+))?/g;

export interface Piece {
  text: string;
  loc?: { path: string; line: number; col: number };
}

export function linkify(text: string): Piece[] {
  const out: Piece[] = [];
  let last = 0;
  for (const m of text.matchAll(LOCATION)) {
    const raw = m[2] ?? m[4];
    const line = Number(m[3] ?? m[5]);
    const col = Number(m[6] ?? 1);
    const start = m.index!;
    const label = m[0];
    if (start > last) out.push({ text: text.slice(last, start) });
    out.push({ text: label, loc: { path: raw.trim(), line, col } });
    last = start + label.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

export async function openLocation(loc: { path: string; line: number; col: number }): Promise<void> {
  const path = resolvePath(run.cwd || ".", loc.path);
  const tab = await openFile(path);
  if (tab) requestAnimationFrame(() => selectLine(loc.line, loc.col));
}
