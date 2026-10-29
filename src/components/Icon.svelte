<script lang="ts">
  let { name, size = 16 }: { name: string; size?: number } = $props();

  // 16×16 stroke icons, drawn to match Windows 11's thin style.
  const paths: Record<string, string> = {
    plus: "M8 3v10M3 8h10",
    close: "M4 4l8 8M12 4l-8 8",
    more: "M3.5 8h.01M8 8h.01M12.5 8h.01",
    min: "M3 8h10",
    max: "M3.5 3.5h9v9h-9z",
    restore: "M5.5 3.5h7v7M3.5 5.5h7v7h-7z",
    up: "M4 10l4-4 4 4",
    down: "M4 6l4 4 4-4",
    right: "M6 4l4 4-4 4",
    search: "M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM10.6 10.6 14 14",
    replace: "M3 5h7l-2-2M13 11H6l2 2",
    replaceAll: "M2 4.5h7l-2-2M14 11.5H7l2 2M2 8h12",
    check: "M3 8.5l3.2 3L13 4.5",
    eye: "M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
    code: "M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5",
    split: "M2.5 3.5h11v9h-11zM8 3.5v9",
    warn: "M8 2 14.5 13.5h-13zM8 6.5v3M8 11.5h.01",
    info: "M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM8 7.5v4M8 5h.01",
  };
</script>

<svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width={name === "more" ? 2.2 : 1.25} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d={paths[name] ?? ""} />
</svg>
