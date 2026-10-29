<script lang="ts">
  import { untrack } from "svelte";
  import { ipc } from "../lib/ipc";
  import { IS_WINDOWS } from "../lib/platform";
  import { LANGUAGES, programOf, type Runner } from "../lib/runners";
  import { setSetting, settings } from "../lib/settings.svelte";
  import Icon from "./Icon.svelte";

  interface Entry {
    id: string;
    name: string;
    exts: string[];
    base: Runner | null;
  }

  type Info = { path: string; version: string } | null | "loading";

  let open: string | null = $state(null);
  let newExt = $state("");
  const tools: Record<string, Info> = $state({});

  const entries: Entry[] = $derived([
    ...LANGUAGES.map((l) => ({ id: l.exts[0], name: l.name, exts: l.exts, base: l.runner })),
    ...Object.keys(settings.runners)
      .filter((e) => !LANGUAGES.some((l) => l.exts.includes(e)))
      .map((e) => ({ id: e, name: `.${e} files`, exts: [e], base: null })),
  ]);

  function current(e: Entry): { compile: string; run: string } {
    const c = settings.runners[e.id];
    return {
      compile: c && "compile" in c ? (c.compile ?? "") : (e.base?.compile ?? ""),
      run: c?.run || e.base?.run || "",
    };
  }

  function customized(e: Entry): boolean {
    return !!settings.runners[e.id];
  }

  function program(e: Entry): string | null {
    const c = current(e);
    return programOf(c.compile || undefined) ?? programOf(c.run);
  }

  function detect(p: string | null, force = false) {
    if (!p || (!force && p in tools)) return;
    tools[p] = "loading";
    ipc
      .toolInfo(p)
      .then((i) => (tools[p] = i))
      .catch(() => (tools[p] = null));
  }

  $effect(() => {
    const programs = entries.map(program);
    untrack(() => programs.forEach((p) => detect(p)));
  });

  function save(e: Entry, field: "compile" | "run", value: string) {
    const next = { ...current(e), [field]: value.trim() };
    const runners = { ...settings.runners };
    const same = e.base && next.compile === (e.base.compile ?? "") && next.run === e.base.run;
    for (const ext of e.exts) {
      if (same) delete runners[ext];
      else runners[ext] = { compile: next.compile, run: next.run };
    }
    setSetting("runners", runners);
    detect(program(e), true);
  }

  function reset(e: Entry) {
    const runners = { ...settings.runners };
    for (const ext of e.exts) delete runners[ext];
    setSetting("runners", runners);
  }

  function add() {
    const ext = newExt.trim().replace(/^\./, "").toLowerCase();
    if (!/^[\w+-]+$/.test(ext)) return;
    if (!entries.some((e) => e.exts.includes(ext))) setSetting("runners", { ...settings.runners, [ext]: { compile: "", run: "" } });
    open = entries.find((e) => e.exts.includes(ext))?.id ?? ext;
    newExt = "";
  }

  const exeHint = IS_WINDOWS ? "${dir}\\${name}.exe" : "${dir}/${name}";
</script>

<section>
  <h2>Languages</h2>
  <p class="note">
    Margin uses the compilers and interpreters on your PATH. Click a language to change its commands. Variables:
    <code>${"{file}"}</code> <code>${"{dir}"}</code> <code>${"{name}"}</code> <code>${"{base}"}</code> and <code>${"{exe}"}</code> ({exeHint}).
  </p>
  <div class="langs">
    {#each entries as e (e.id)}
      {@const p = program(e)}
      {@const info = p ? tools[p] : undefined}
      <div class="lang" class:open={open === e.id}>
        <button class="head" onclick={() => (open = open === e.id ? null : e.id)} aria-expanded={open === e.id}>
          <span class="chev"><Icon name="right" size={12} /></span>
          <span class="name">{e.name}</span>
          <span class="exts">{e.exts.map((x) => "." + x).join(" ")}</span>
          {#if customized(e)}<span class="tag">custom</span>{/if}
          <span class="spacer"></span>
          {#if p}
            {#if info === "loading"}
              <span class="tool dim">checking {p}…</span>
            {:else if info}
              <span class="tool ok" title={info.path}><i></i>{info.version || p}</span>
            {:else}
              <span class="tool missing" title="{p} wasn't found on PATH"><i></i>{p} not found</span>
            {/if}
          {/if}
        </button>
        {#if open === e.id}
          {@const c = current(e)}
          <div class="body">
            <label>
              <span>Compile</span>
              <input
                class="text-input mono"
                value={c.compile}
                placeholder="None — the file runs directly"
                spellcheck="false"
                onchange={(ev) => save(e, "compile", (ev.currentTarget as HTMLInputElement).value)}
              />
            </label>
            <label>
              <span>Run</span>
              <input
                class="text-input mono"
                value={c.run}
                placeholder={'e.g. python -u "${file}"'}
                spellcheck="false"
                onchange={(ev) => save(e, "run", (ev.currentTarget as HTMLInputElement).value)}
              />
            </label>
            <div class="foot">
              {#if info && info !== "loading"}<span class="path" title={info.path}>{info.path}</span>{/if}
              <span class="spacer"></span>
              {#if customized(e)}
                <button class="btn small" onclick={() => reset(e)}>{e.base ? "Reset to default" : "Remove"}</button>
              {/if}
            </div>
          </div>
        {/if}
      </div>
    {/each}
  </div>
  <div class="add">
    <input
      class="text-input"
      bind:value={newExt}
      placeholder="Another file type, e.g. .kt"
      spellcheck="false"
      onkeydown={(e) => e.key === "Enter" && add()}
    />
    <button class="btn small" onclick={add} disabled={!newExt.trim()}>Add</button>
  </div>
</section>

<style>
  section {
    margin-top: 22px;
  }
  h2 {
    margin: 0 0 6px;
    font-size: 11.5px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .note {
    margin: 0 0 12px;
    color: var(--faint);
    font-size: 12px;
    line-height: 1.6;
  }
  code {
    font: 11.5px var(--mono-font);
    color: var(--muted);
  }
  .langs {
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
  }
  .lang + .lang {
    border-top: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 36px;
    padding: 0 12px 0 8px;
    text-align: left;
  }
  .head:hover {
    background: color-mix(in srgb, var(--surface-2) 60%, transparent);
  }
  .chev {
    display: grid;
    color: var(--faint);
    transition: transform 0.12s var(--ease);
  }
  .open .chev {
    transform: rotate(90deg);
  }
  .name {
    font-size: 13px;
  }
  .exts {
    color: var(--faint);
    font: 11.5px var(--mono-font);
  }
  .tag {
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 10.5px;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  .spacer {
    flex: 1;
  }
  .tool {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 50%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11.5px;
    color: var(--muted);
  }
  .tool i {
    width: 6px;
    height: 6px;
    flex-shrink: 0;
    border-radius: 50%;
  }
  .tool.ok i {
    background: var(--tk-string);
  }
  .tool.missing {
    color: var(--danger);
  }
  .tool.missing i {
    background: var(--danger);
  }
  .tool.dim {
    color: var(--faint);
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 4px 12px 12px 32px;
  }
  label {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  label span {
    width: 56px;
    color: var(--muted);
    font-size: 12px;
  }
  label input {
    flex: 1;
  }
  .mono {
    font: 12px var(--mono-font);
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 24px;
  }
  .path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--faint);
    font: 11px var(--mono-font);
  }
  .add {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }
  .add input {
    width: 220px;
  }
</style>
