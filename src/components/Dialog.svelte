<script lang="ts">
  import { ui } from "../lib/ui.svelte";

  let box: HTMLDivElement | undefined = $state();

  $effect(() => {
    if (ui.dialog && box) {
      const primary = box.querySelector<HTMLButtonElement>("button.primary") ?? box.querySelector<HTMLButtonElement>("button");
      primary?.focus();
    }
  });

  function onKey(e: KeyboardEvent) {
    const d = ui.dialog;
    if (!d) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      d.resolve(d.cancelValue);
    } else if (e.key === "Tab" && box) {
      // Keep focus inside the dialog.
      const buttons = [...box.querySelectorAll<HTMLButtonElement>("button")];
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      e.preventDefault();
      buttons[(i + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
    }
  }
</script>

<svelte:window onkeydowncapture={onKey} />

{#if ui.dialog}
  {@const d = ui.dialog}
  <div class="backdrop" role="presentation" onmousedown={(e) => e.target === e.currentTarget && d.resolve(d.cancelValue)}>
    <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" bind:this={box}>
      <h2 id="dlg-title">{d.title}</h2>
      {#if d.message}<p class="message">{d.message}</p>{/if}
      {#if d.detail}<p class="detail">{d.detail}</p>{/if}
      <div class="buttons">
        {#each d.buttons as b (b.value)}
          <button class="btn" class:primary={b.primary} class:danger={b.danger} onclick={() => d.resolve(b.value)}>{b.label}</button>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.28);
    display: grid;
    place-items: center;
    z-index: 50;
    animation: fade 0.12s ease;
  }
  .dialog {
    width: min(440px, calc(100vw - 32px));
    padding: 22px 22px 18px;
    border-radius: 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
    animation: pop 0.16s var(--ease);
  }
  h2 {
    margin: 0 0 8px;
    font-size: 15px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .message,
  .detail {
    margin: 0 0 6px;
    color: var(--muted);
    white-space: pre-line;
    line-height: 1.55;
    user-select: text;
    overflow-wrap: anywhere;
  }
  .detail {
    font-size: 12px;
    color: var(--faint);
  }
  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 18px;
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: scale(0.97);
    }
  }
</style>
