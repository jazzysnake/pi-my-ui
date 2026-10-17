<script lang="ts">
  /**
   * PROTOTYPE — three transcript-row variants, switchable with `?variant=` and a floating bar.
   *
   * The question: with copy controls on messages, thinking rows, and fenced code, where does a
   * message's boundary have to be drawn so a reader can tell whose control is whose — while tool
   * calls stay exactly as they are and remain a distinguishable object?
   */
  import VariantA from "./VariantA.svelte";
  import VariantB from "./VariantB.svelte";
  import VariantC from "./VariantC.svelte";

  type VariantKey = "A" | "B" | "C";

  const VARIANTS: readonly { readonly key: VariantKey; readonly name: string }[] = [
    { key: "A", name: "Bordered card" },
    { key: "B", name: "Rail + gutter" },
    { key: "C", name: "Header rule" },
  ];

  const params = new URLSearchParams(window.location.search);

  const requested = (params.get("variant") ?? "A").toUpperCase();
  let variant = $state<VariantKey>(
    VARIANTS.some((entry) => entry.key === requested) ? (requested as VariantKey) : "A",
  );
  let errorShape = $state<"card" | "strip">(params.get("errors") === "strip" ? "strip" : "card");
  // `?w=320` narrows the content column so the variants can be judged at the smallest phone.
  const narrow = params.get("w") === "320";

  const DEFAULT_VARIANT = { key: "A", name: "Bordered card" } as const;
  const current = $derived(VARIANTS.find((entry) => entry.key === variant) ?? DEFAULT_VARIANT);

  function setParam(name: string, value: string | null): void {
    const url = new URL(window.location.href);
    if (value === null) {
      url.searchParams.delete(name);
    } else {
      url.searchParams.set(name, value);
    }
    window.history.replaceState(null, "", url);
  }

  function cycle(step: number): void {
    const index = VARIANTS.findIndex((entry) => entry.key === variant);
    const next = VARIANTS[(index + step + VARIANTS.length) % VARIANTS.length];
    if (next === undefined) {
      return;
    }
    variant = next.key;
    setParam("variant", next.key);
  }

  function toggleErrors(): void {
    errorShape = errorShape === "card" ? "strip" : "card";
    setParam("errors", errorShape);
  }

  /** Arrow keys cycle the variant, unless a field has focus and the arrows are its own. */
  $effect(() => {
    function onKey(event: KeyboardEvent): void {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, [contenteditable]")) {
        return;
      }
      if (event.key === "ArrowLeft") {
        cycle(-1);
      } else if (event.key === "ArrowRight") {
        cycle(1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  });
</script>

<div class="min-h-dvh bg-canvas px-3 pt-3 pb-28 text-ink">
  <div class={narrow ? "mx-auto w-full max-w-[320px]" : "mx-auto w-full max-w-[430px]"}>
    {#if variant === "A"}
      <VariantA {errorShape} />
    {:else if variant === "B"}
      <VariantB {errorShape} />
    {:else}
      <VariantC {errorShape} />
    {/if}
  </div>
</div>

<div
  class="fixed bottom-3 left-1/2 flex max-w-[calc(100vw-1rem)] -translate-x-1/2 items-center gap-0.5 rounded-full border border-hairline-strong bg-panel-raised px-1 py-1 shadow-lg"
  data-testid="prototype-switcher"
>
  <button
    type="button"
    class="grid size-8 shrink-0 place-items-center rounded-full text-dim"
    aria-label="Previous variant"
    onclick={() => {
      cycle(-1);
    }}>←</button
  >
  <span class="min-w-24 shrink px-1 text-center text-meta" data-testid="prototype-label">
    <span class="text-ink">{current.key}</span>
    <span class="text-faint"> · {current.name}</span>
  </span>
  <button
    type="button"
    class="grid size-8 shrink-0 place-items-center rounded-full text-dim"
    aria-label="Next variant"
    onclick={() => {
      cycle(1);
    }}>→</button
  >
  <span class="mx-1 h-5 w-px bg-hairline-strong"></span>
  <button
    type="button"
    class="h-8 shrink-0 rounded-full px-1.5 text-[10px] text-dim"
    onclick={toggleErrors}
    data-testid="prototype-errors"
  >
    err: <span class="text-ink">{errorShape}</span>
  </button>
</div>
