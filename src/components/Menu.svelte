<script lang="ts">
  import { ui } from "../lib/ui.svelte";

  let el: HTMLDivElement | undefined = $state();
  let index = $state(-1);
  let pos = $state({ x: 0, y: 0 });

  $effect(() => {
    const m = ui.menu;
    if (!m || !el) return;
    index = -1;
    // Keep the menu on screen.
    const r = el.getBoundingClientRect();
    let x = m.align === "right" ? m.x - r.width : m.x;
    let y = m.y;
    x = Math.max(6, Math.min(x, window.innerWidth - r.width - 6));
    if (y + r.height > window.innerHeight - 6) y = Math.max(6, window.innerHeight - r.height - 6);
    pos = { x, y };
    el.focus();
  });

  function close() {
    ui.menu = null;
  }

  function choose(i: number) {
    const item = ui.menu?.items[i];
    if (!item || item.separator || item.disabled) return;
    close();
    setTimeout(() => item.run?.());
  }

  function onKey(e: KeyboardEvent) {
    const items = ui.menu?.items ?? [];
    const step = (d: number) => {
      for (let n = 0; n < items.length; n++) {
        index = (index + d + items.length) % items.length;
        if (!items[index].separator && !items[index].disabled) break;
      }
    };
    if (e.key === "ArrowDown") {
      e.preventDefault();
      step(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      step(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(index);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }
</script>

{#if ui.menu}
  <div class="catcher" role="presentation" onmousedown={close} oncontextmenu={(e) => (e.preventDefault(), close())}></div>
  <div class="menu" role="menu" tabindex="-1" bind:this={el} style="left:{pos.x}px; top:{pos.y}px" onkeydown={onKey}>
    {#each ui.menu.items as item, i}
      {#if item.separator}
        <div class="sep"></div>
      {:else}
        <button
          class="item"
          class:active={i === index}
          class:danger={item.danger}
          role="menuitem"
          disabled={item.disabled}
          onmouseenter={() => (index = i)}
          onclick={() => choose(i)}
        >
          <span class="check">{item.checked ? "✓" : ""}</span>
          <span class="label">{item.label}</span>
          {#if item.hint}<kbd>{item.hint}</kbd>{/if}
        </button>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .catcher {
    position: fixed;
    inset: 0;
    z-index: 40;
  }
  .menu {
    position: fixed;
    z-index: 41;
    min-width: 220px;
    padding: 5px;
    border-radius: 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
    outline: none;
    animation: drop 0.12s var(--ease);
  }
  .item {
    display: flex;
    align-items: center;
    width: 100%;
    height: 30px;
    padding: 0 10px 0 4px;
    border-radius: 6px;
    text-align: left;
    gap: 6px;
  }
  .item.active {
    background: var(--surface-2);
  }
  .item:disabled {
    opacity: 0.4;
  }
  .item.danger {
    color: var(--danger);
  }
  .check {
    width: 16px;
    text-align: center;
    color: var(--accent);
    font-size: 12px;
  }
  .label {
    flex: 1;
  }
  kbd {
    margin-left: 24px;
  }
  .sep {
    height: 1px;
    margin: 5px 6px;
    background: var(--border);
  }
  @keyframes drop {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }
</style>
