import "@fontsource-variable/jetbrains-mono";
import "./app.css";
import { mount } from "svelte";
import App from "./App.svelte";
import { boot } from "./lib/boot";
import { loadSettingsText } from "./lib/settings.svelte";
import { initTheme } from "./lib/theme.svelte";

// Settings and theme are applied before the first render so nothing flashes.
loadSettingsText(boot.settingsText);
initTheme();

export default mount(App, { target: document.getElementById("app")! });

// Dev builds expose internals for testing; removed from release builds.
if (import.meta.env.DEV) {
  Promise.all([import("./lib/tabs.svelte"), import("./lib/settings.svelte"), import("./lib/ui.svelte")]).then(([tabs, s, ui]) =>
    Object.assign(window, { __margin: { tabs, settings: s, ui } }),
  );
}
