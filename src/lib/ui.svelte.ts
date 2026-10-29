export interface PaletteItem {
  id: string;
  label: string;
  detail?: string;
  hint?: string;
  /** Marks the item that is current (e.g. the active theme). */
  current?: boolean;
}

export interface PaletteConfig {
  placeholder: string;
  /** Static list, filtered by fuzzy match — or a function that builds the list from the query. */
  items: PaletteItem[] | ((query: string) => PaletteItem[]);
  onSelect: (item: PaletteItem, query: string) => void;
  onHighlight?: (item: PaletteItem | null) => void;
  onCancel?: () => void;
  initialQuery?: string;
  emptyText?: string;
}

export interface MenuItem {
  label?: string;
  hint?: string;
  disabled?: boolean;
  checked?: boolean;
  danger?: boolean;
  separator?: boolean;
  run?: () => void;
}

export interface DialogButton {
  label: string;
  value: string;
  primary?: boolean;
  danger?: boolean;
}

export interface DialogConfig {
  title: string;
  message?: string;
  detail?: string;
  buttons: DialogButton[];
  cancelValue: string;
  resolve: (value: string) => void;
}

export interface Toast {
  id: number;
  message: string;
  kind: "info" | "error";
  action?: { label: string; run: () => void };
}

export const ui = $state({
  palette: null as PaletteConfig | null,
  settingsOpen: false,
  settingsSection: "appearance",
  menu: null as { x: number; y: number; items: MenuItem[]; align?: "left" | "right" } | null,
  dialog: null as DialogConfig | null,
  toasts: [] as Toast[],
  find: {
    open: false,
    replace: false,
    query: "",
    replaceText: "",
    caseSensitive: false,
    wholeWord: false,
    regex: false,
    /** Bumped to ask the find bar to focus and select its input. */
    focusToken: 0,
  },
  zen: false,
  alwaysOnTop: false,
  maximized: false,
  dropping: false,
  splitRatio: 0.5,
});

let toastId = 0;

export function toast(message: string, opts: { kind?: "info" | "error"; action?: Toast["action"]; ms?: number } = {}): void {
  const id = ++toastId;
  ui.toasts = [...ui.toasts.slice(-3), { id, message, kind: opts.kind ?? "info", action: opts.action }];
  setTimeout(() => dismissToast(id), opts.ms ?? (opts.kind === "error" ? 6000 : 3200));
}

export function dismissToast(id: number): void {
  ui.toasts = ui.toasts.filter((t) => t.id !== id);
}

/** Shows an in-app dialog and resolves with the chosen button's value. */
export function ask(config: Omit<DialogConfig, "resolve">): Promise<string> {
  return new Promise((resolve) => {
    // A newer dialog replaces an older one; the older one resolves as cancelled.
    ui.dialog?.resolve(ui.dialog.cancelValue);
    ui.dialog = {
      ...config,
      resolve: (v) => {
        ui.dialog = null;
        resolve(v);
      },
    };
  });
}

export function openPalette(config: PaletteConfig): void {
  ui.palette = config;
}

export function openMenu(x: number, y: number, items: MenuItem[], align: "left" | "right" = "left"): void {
  ui.menu = { x, y, items, align };
}

export function anyOverlayOpen(): boolean {
  return !!(ui.palette || ui.settingsOpen || ui.menu || ui.dialog);
}
