<script lang="ts">
  import { tick } from "svelte";
  import { build, clearOutput, endInput, linkify, openLocation, output, run, sendInput, stop } from "../lib/run.svelte";
  import Icon from "./Icon.svelte";

  let body: HTMLDivElement | undefined = $state();
  let input: HTMLInputElement | undefined = $state();
  let text = $state("");
  let stick = true;

  const busy = $derived(run.phase === "compiling" || run.phase === "running");

  // Follow new output, unless the user has scrolled up to read something.
  $effect(() => {
    void output.version;
    if (!stick) return;
    tick().then(() => body && (body.scrollTop = body.scrollHeight));
  });

  $effect(() => {
    if (run.acceptsInput && run.open) tick().then(() => input?.focus());
  });

  function onScroll() {
    if (body) stick = body.scrollHeight - body.scrollTop - body.clientHeight < 24;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      sendInput(text);
      text = "";
      stick = true;
    } else if ((e.key === "z" || e.key === "d") && e.ctrlKey) {
      e.preventDefault();
      endInput();
    } else if (e.key === "c" && e.ctrlKey && input && input.selectionStart === input.selectionEnd) {
      e.preventDefault();
      stop();
    }
  }

  function startResize(e: PointerEvent) {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startH = run.height;
    const max = window.innerHeight - 160;
    const move = (ev: PointerEvent) => (run.height = Math.round(Math.min(max, Math.max(90, startH + startY - ev.clientY))));
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }
</script>

{#if run.open}
  <section class="panel" style="height:{run.height}px" aria-label="Output">
    <div class="grip" role="separator" aria-orientation="horizontal" onpointerdown={startResize}></div>
    <header>
      <span class="state {run.phase}">
        {#if busy}<span class="pulse"></span>{/if}
        {run.status || "Output"}
      </span>
      <span class="spacer"></span>
      {#if busy}
        <button class="icon-btn" title="Stop (Shift+F5)" aria-label="Stop" onclick={stop}><Icon name="stop" size={12} /></button>
      {:else if run.phase !== "idle"}
        <button class="icon-btn" title="Run again (F5)" aria-label="Run again" onclick={() => build(true)}><Icon name="play" size={13} /></button>
      {/if}
      <button class="icon-btn" title="Clear" aria-label="Clear output" onclick={clearOutput}><Icon name="clear" size={14} /></button>
      <button class="icon-btn" title="Close (Ctrl+J)" aria-label="Close output" onclick={() => (run.open = false)}><Icon name="close" size={13} /></button>
    </header>
    <div class="body" bind:this={body} onscroll={onScroll}>
      <pre>{#each output.chunks as c}{#if c.kind === "out" || c.kind === "err"}<span class={c.kind}>{#each linkify(c.text) as p}{#if p.loc}<button class="loc" title="Go to {p.loc.path}:{p.loc.line}" onclick={() => openLocation(p.loc!)}>{p.text}</button>{:else}{p.text}{/if}{/each}</span>{:else}<span class={c.kind}>{c.text}</span>{/if}{/each}</pre>
      {#if !output.chunks.length}
        <div class="empty">Press <kbd>F5</kbd> to compile and run, or <kbd>Ctrl+Shift+B</kbd> to compile.</div>
      {/if}
    </div>
    {#if run.acceptsInput}
      <div class="stdin">
        <span class="prompt">›</span>
        <input
          bind:this={input}
          bind:value={text}
          class="field"
          placeholder="Input for the program — Enter sends a line, Ctrl+Z ends input"
          spellcheck="false"
          autocomplete="off"
          onkeydown={onKey}
        />
      </div>
    {/if}
  </section>
{/if}

<style>
  .panel {
    position: relative;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    min-height: 0;
    border-top: 1px solid var(--border);
    background: var(--surface);
  }
  .grip {
    position: absolute;
    top: -3px;
    left: 0;
    right: 0;
    height: 6px;
    cursor: row-resize;
    z-index: 2;
  }
  .grip:hover {
    background: linear-gradient(to bottom, transparent 2px, var(--accent) 2px, var(--accent) 4px, transparent 4px);
  }
  header {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 32px;
    padding: 0 6px 0 14px;
    flex-shrink: 0;
  }
  header .icon-btn {
    width: 26px;
    height: 24px;
  }
  .state {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--muted);
  }
  .state.done {
    color: var(--tk-string);
  }
  .state.failed {
    color: var(--danger);
  }
  .pulse {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    animation: pulse 1s ease-in-out infinite alternate;
  }
  @keyframes pulse {
    to {
      opacity: 0.25;
    }
  }
  .spacer {
    flex: 1;
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 2px 14px 10px;
    user-select: text;
    -webkit-user-select: text;
  }
  pre {
    margin: 0;
    font: 12.5px/1.55 var(--mono-font);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--fg);
  }
  .err {
    color: color-mix(in srgb, var(--danger) 85%, var(--fg));
  }
  .info {
    color: var(--faint);
  }
  .input {
    color: var(--accent);
  }
  .ok {
    color: var(--tk-string);
  }
  .fail {
    color: var(--danger);
  }
  .loc {
    font: inherit;
    color: inherit;
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, currentColor 40%, transparent);
    text-underline-offset: 2px;
    cursor: pointer;
  }
  .loc:hover {
    color: var(--accent);
    text-decoration-color: var(--accent);
  }
  .empty {
    padding: 8px 0;
    color: var(--faint);
    font-size: 12.5px;
  }
  .empty kbd {
    padding: 1px 5px;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--muted);
  }
  .stdin {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 14px;
    flex-shrink: 0;
    border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  }
  .prompt {
    color: var(--accent);
    font: 14px var(--mono-font);
  }
  .field {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: none;
    outline: none;
    background: transparent;
    font: 12.5px var(--mono-font);
  }
  .field::placeholder {
    color: var(--faint);
  }
</style>
