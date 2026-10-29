/** Margin runs on Windows and Linux; a few things (title bar, paths, default commands) differ. */
export const IS_WINDOWS = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);
