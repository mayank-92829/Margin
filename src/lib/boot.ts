export interface BootData {
  settingsText: string | null;
  sessionText: string | null;
  customThemes: { file: string; text: string }[];
  paths: { settings: string; themes: string; config: string };
  version: string;
}

declare global {
  interface Window {
    __MARGIN_BOOT__?: BootData;
  }
}

/** Injected by the Rust side before any script runs, so startup needs no round trip. */
export const boot: BootData = window.__MARGIN_BOOT__ ?? {
  settingsText: null,
  sessionText: null,
  customThemes: [],
  paths: { settings: "", themes: "", config: "" },
  version: "dev",
};
