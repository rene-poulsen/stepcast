<script lang="ts">
  // Line icons in the style of Lucide (ISC license), drawn on a 24×24 grid.
  const paths = {
    camera: 'M23 7l-7 5 7 5V7z M3 5h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
    mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z M19 10v2a7 7 0 0 1-14 0v-2 M12 19v3',
    monitor: 'M3 4h18a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M8 21h8 M12 17v4',
    screenCam: 'M3 4h18a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M8 21h8 M12 17v4 M14 9h5v5h-5z',
    pause: 'M7 4h3v16H7z M14 4h3v16h-3z',
    play: 'M7 4l13 8-13 8V4z',
    stop: 'M6 6h12v12H6z',
    trash: 'M3 6h18 M8 6V4h8v2 M19 6l-1 14H6L5 6',
    folder: 'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z',
    back: 'M15 18l-6-6 6-6',
    download: 'M12 3v12 M7 10l5 5 5-5 M5 21h14',
    guide: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z M14 3v6h6 M8 13h8 M8 17h5',
    check: 'M20 6L9 17l-5-5',
    x: 'M18 6L6 18 M6 6l12 12',
    eyeOff: 'M3 3l18 18 M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3 3.6 M6.6 6.6A17 17 0 0 0 2 12s4 7 10 7a9.7 9.7 0 0 0 5.4-1.6 M9.9 9.9a3 3 0 0 0 4.2 4.2',
    copy: 'M9 9h11v11H9z M5 15H4V4h11v1',
    puzzle: 'M10 3a2 2 0 0 1 4 0v2h4a1 1 0 0 1 1 1v4h-2a2 2 0 0 0 0 4h2v4a1 1 0 0 1-1 1h-4v-2a2 2 0 0 0-4 0v2H6a1 1 0 0 1-1-1v-4h2a2 2 0 0 0 0-4H5V6a1 1 0 0 1 1-1h4V3z',
    sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 17l.7 1.8 1.8.7-1.8.7L19 22l-.7-1.8-1.8-.7 1.8-.7z',
    restore: 'M3 12a9 9 0 1 0 3-6.7L3 8 M3 3v5h5',
  } as const;

  let { name, size = 16 }: { name: keyof typeof paths; size?: number } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.8"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#each paths[name].split(' M') as d, i}
    <path d={i === 0 ? d : 'M' + d} />
  {/each}
</svg>
