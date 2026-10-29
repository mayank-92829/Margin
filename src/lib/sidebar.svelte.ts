import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ipc, parseError, type DirEntry } from "./ipc";
import { basename, dirname, isAbsolute, joinPath } from "./path";

export { joinPath };
import { settings } from "./settings.svelte";
import { activeTab, openFile, openPaths, scheduleSession, tabsState } from "./tabs.svelte";
import { openPalette, toast, ui } from "./ui.svelte";

/** Folder contents by full path; a folder that isn't here hasn't been read yet. */
export const tree = $state({ children: {} as Record<string, DirEntry[]>, errors: {} as Record<string, string> });

const HIDDEN = new Set([".git", "$recycle.bin", "system volume information", "desktop.ini", "thumbs.db"]);

export async function loadDir(path: string): Promise<void> {
  try {
    const list = await ipc.listDir(path);
    tree.children[path] = list.filter((e) => !HIDDEN.has(e.name.toLowerCase()));
    delete tree.errors[path];
  } catch (e) {
    tree.errors[path] = parseError(e).message;
    tree.children[path] = [];
  }
}

/** Re-reads the open folder and every expanded folder inside it (picks up new and deleted files). */
export async function refreshTree(): Promise<void> {
  const root = ui.sidebar.folder;
  if (!root || !ui.sidebar.open) return;
  const prefix = root.toLowerCase();
  const dirs = [root, ...Object.keys(ui.sidebar.expanded).filter((p) => p.toLowerCase().startsWith(prefix) && p !== root)];
  await Promise.all(dirs.map(loadDir));
}

export function setFolder(path: string | null): void {
  ui.sidebar.folder = path;
  ui.sidebar.expanded = {};
  tree.children = {};
  tree.errors = {};
  if (path) {
    ui.sidebar.open = true;
    loadDir(path);
  }
  scheduleSession();
}

export async function openFolderDialog(): Promise<void> {
  const t = activeTab();
  const res = await openDialog({ directory: true, multiple: false, defaultPath: ui.sidebar.folder ?? (t?.path ? dirname(t.path) : undefined) });
  if (typeof res === "string") setFolder(res);
}

export function toggleSidebar(): void {
  ui.sidebar.open = !ui.sidebar.open;
  // Opening it without a folder shows the folder of the file being edited.
  const t = activeTab();
  if (ui.sidebar.open && !ui.sidebar.folder && t?.path) setFolder(dirname(t.path));
  else if (ui.sidebar.open) refreshTree();
  scheduleSession();
}

export function toggleDir(path: string): void {
  if (ui.sidebar.expanded[path]) {
    delete ui.sidebar.expanded[path];
  } else {
    ui.sidebar.expanded[path] = true;
    loadDir(path);
  }
  scheduleSession();
}

export function collapseAll(): void {
  ui.sidebar.expanded = {};
  scheduleSession();
}

/** Opens files as tabs and folders in the sidebar (drag and drop, command line). */
export async function openAny(paths: string[]): Promise<void> {
  const files: string[] = [];
  for (const p of paths) {
    if (await ipc.isDir(p).catch(() => false)) setFolder(p);
    else files.push(p);
  }
  if (files.length) await openPaths(files);
}

export function newFileIn(dir: string): void {
  openPalette({
    placeholder: `New file in ${basename(dir)}`,
    items: (q) => {
      const name = q.trim();
      if (!name) return [{ id: "", label: "Type a file name, e.g. main.c" }];
      if (/[<>:"|?*]/.test(name) || isAbsolute(name)) return [{ id: "", label: "That isn't a valid file name" }];
      return [{ id: name, label: `Create “${name}”`, detail: basename(dir) }];
    },
    onSelect: async (item) => {
      if (!item.id) return;
      const path = joinPath(dir, item.id);
      try {
        const [existing] = await ipc.statFiles([path]);
        if (!existing) await ipc.writeTextFile(path, "", settings.defaultEncoding, false, settings.defaultEol);
        if (!ui.sidebar.expanded[dir] && dir !== ui.sidebar.folder) ui.sidebar.expanded[dir] = true;
        await loadDir(dirname(path));
        await openFile(path);
      } catch (e) {
        toast(`Couldn't create ${item.id}: ${parseError(e).message}`, { kind: "error" });
      }
    },
  });
}

/** Path of the active tab, for highlighting it in the tree. */
export function activePath(): string | null {
  const t = tabsState.list.find((x) => x.id === tabsState.activeId);
  return t?.path ?? null;
}
