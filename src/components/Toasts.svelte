<script lang="ts">
  import { dismissToast, ui } from "../lib/ui.svelte";
</script>

<div class="toasts" aria-live="polite">
  {#each ui.toasts as t (t.id)}
    <div class="toast" class:error={t.kind === "error"}>
      <span class="msg">{t.message}</span>
      {#if t.action}
        <button class="action" onclick={() => (t.action!.run(), dismissToast(t.id))}>{t.action.label}</button>
      {/if}
      <button class="x" aria-label="Dismiss" onclick={() => dismissToast(t.id)}>×</button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    left: 50%;
    bottom: 40px;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    z-index: 60;
    pointer-events: none;
  }
  .toast {
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: min(560px, 90vw);
    padding: 8px 8px 8px 14px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--fg) 92%, var(--bg));
    color: var(--bg);
    box-shadow: var(--shadow);
    font-size: 12.5px;
    pointer-events: auto;
    animation: rise 0.18s var(--ease);
  }
  .toast.error {
    background: var(--danger);
    color: #fff;
  }
  .msg {
    white-space: pre-line;
  }
  .action {
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 4px;
  }
  .action:hover,
  .x:hover {
    background: color-mix(in srgb, currentColor 15%, transparent);
  }
  .x {
    width: 20px;
    height: 20px;
    border-radius: 4px;
    opacity: 0.6;
    font-size: 15px;
    line-height: 1;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
</style>
