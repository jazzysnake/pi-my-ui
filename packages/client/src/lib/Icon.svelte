<script lang="ts">
  /**
   * One vendored Lucide icon — the client's only renderer for `lib/icons`.
   *
   * `viewBox`, stroke and caps are decided once here, so a control's icon and a row's marker are
   * the same drawing in different boxes; the artwork is `currentColor`, so colour stays the
   * caller's token. `data-icon` names the glyph for tests that assert which icon was drawn.
   */
  import { ICONS, type IconGeometry, type IconName } from "./icons/index.js";

  interface Props {
    readonly name: IconName;
    /**
     * The `<svg>` box and colour. The default consumes the control-glyph size token, so a
     * glyph-only control has one declared size; a marker sized to its row passes `size-4` instead.
     */
    readonly class?: string;
  }

  let { name, class: className = "size-[var(--text-control-glyph)]" }: Props = $props();

  // Widened to the interface so the optional `paths`/`circles`/`rects` are all in view: the record's
  // `as const` value keeps each entry's literal shape (missing keys stay absent).
  const geometry: IconGeometry = $derived(ICONS[name]);
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  class={className}
  aria-hidden="true"
  data-icon={name}
>
  {#each geometry.paths ?? [] as d, index (index)}
    <path {d} />
  {/each}
  {#each geometry.circles ?? [] as circle, index (index)}
    <circle cx={circle.cx} cy={circle.cy} r={circle.r} />
  {/each}
  {#each geometry.rects ?? [] as rect, index (index)}
    <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx={rect.rx} />
  {/each}
</svg>
