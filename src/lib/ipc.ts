import { invoke } from "@tauri-apps/api/core";

export interface FileStat {
  size: number;
  mtime: number;
  readonly: boolean;
}

export type Eol = "CRLF" | "LF" | "CR";

export interface OpenedFile {
  path: string;
  content: string | null;
  encoding: string;
  bom: boolean;
  eol: Eol | "";
  mixedEol: boolean;
  binary: boolean;
  lossy: boolean;
  stat: FileStat;
}

export interface LargeOpened {
  id: number;
  size: number;
  encoding: string;
}

export interface LargeStatus {
  lines: number;
  bytesIndexed: number;
  size: number;
  done: boolean;
  error: string | null;
}

export interface LargeMatch {
  line: number;
  byteStart: number;
  byteEnd: number;
  colStart: number;
  colEnd: number;
  wrapped: boolean;
}

export interface LargeSearchArgs {
  id: number;
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  fromLine: number;
  fromByte: number;
  backward: boolean;
}

export interface DirEntry {
  name: string;
  dir: boolean;
}

export const ipc = {
  readTextFile: (path: string, maxBytes: number, encoding?: string) =>
    invoke<OpenedFile>("read_text_file", { path, maxBytes, encoding: encoding ?? null }),
  writeTextFile: (path: string, content: string, encoding: string, bom: boolean, eol: Eol) =>
    invoke<FileStat>("write_text_file", { path, content, encoding, bom, eol }),
  statFiles: (paths: string[]) => invoke<(FileStat | null)[]>("stat_files", { paths }),
  saveSettings: (text: string) => invoke<void>("save_settings", { text }),
  saveSession: (text: string) => invoke<void>("save_session", { text }),
  writeBackup: (id: string, content: string) => invoke<void>("write_backup", { id, content }),
  readBackup: (id: string) => invoke<string | null>("read_backup", { id }),
  pruneBackups: (keep: string[]) => invoke<void>("prune_backups", { keep }),
  listThemes: () => invoke<{ file: string; text: string }[]>("list_themes"),
  saveTheme: (name: string, text: string) => invoke<string>("save_theme", { name, text }),
  setWindowBg: (hex: string) => invoke<void>("set_window_bg", { hex }),
  takePendingFiles: () => invoke<string[]>("take_pending_files"),
  appReady: () => invoke<void>("app_ready"),
  largeOpen: (path: string) => invoke<LargeOpened>("large_open", { path }),
  largeStatus: (id: number) => invoke<LargeStatus>("large_status", { id }),
  largeLines: (id: number, start: number, count: number) => invoke<string[]>("large_lines", { id, start, count }),
  largeSearch: (args: LargeSearchArgs) => invoke<LargeMatch | null>("large_search", { ...args }),
  largeClose: (id: number) => invoke<void>("large_close", { id }),
  listDir: (path: string) => invoke<DirEntry[]>("list_dir", { path }),
  isDir: (path: string) => invoke<boolean>("is_dir", { path }),
  runStart: (id: number, argv: string[], cwd: string, unbuffer: boolean) => invoke<void>("run_start", { id, argv, cwd, unbuffer }),
  runInput: (id: number, text: string, close = false) => invoke<void>("run_input", { id, text, close }),
  runKill: (id: number) => invoke<void>("run_kill", { id }),
  runInConsole: (argv: string[], cwd: string, title: string) => invoke<void>("run_in_console", { argv, cwd, title }),
};

/** Rust errors look like "CODE:message"; plain messages have no code. */
export function parseError(e: unknown): { code: string; message: string } {
  const text = typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
  const m = /^([A-Z0-9]+):(.*)$/s.exec(text);
  return m ? { code: m[1], message: m[2] } : { code: "", message: text };
}
