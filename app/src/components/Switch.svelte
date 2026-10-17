<script lang="ts">
  let { checked = $bindable(false), onchange, label = '' }: { checked?: boolean; onchange?: () => void; label?: string } =
    $props();
</script>

<button
  class="switch"
  class:on={checked}
  role="switch"
  aria-checked={checked}
  aria-label={label}
  onclick={() => {
    checked = !checked;
    onchange?.();
  }}
>
  <span></span>
</button>

<style>
  .switch {
    flex: none;
    position: relative;
    width: 32px;
    height: 18px;
    padding: 0;
    border: 0;
    border-radius: 99px;
    background: var(--active);
    transition: background 0.15s;
  }

  .switch.on {
    background: var(--accent);
  }

  span {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    transition: transform 0.15s;
  }

  .on span {
    transform: translateX(14px);
  }
</style>
