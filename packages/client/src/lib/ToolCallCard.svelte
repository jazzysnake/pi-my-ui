<script lang="ts">
  /**
   * One tool call, as a scrollback row: a prompt line stating the input, the call's effect beneath
   * it, and a fold where pi's output stops fitting a phone.
   *
   * The body folds because a large read or write must not swallow the transcript. The notice above
   * the fold never does, because pi states its limits at the END of the output — `[Showing lines
   * 1-2000 of 8412. Full output: /tmp/…]`, `[100 matches limit reached. Use limit=200 for more]`,
   * `Command exited with code 3` — which is exactly the line a cap would hide.
   */

  import { ToolCallStatus, type ToolCallBlock } from "@pi-my-ui/protocol";

  import {
    clipLines,
    detailPairs,
    ellipsizeMiddle,
    endingLabel,
    isListTool,
    isShellTool,
    lineCount,
    outputTail,
    payloadOf,
    readStart,
    readWindow,
    sizeLabel,
    targetOf,
    type EditPair,
  } from "./tools/call.js";

  let { block }: { block: ToolCallBlock } = $props();

  /** Folded preview sizes, by what the tool returns. */
  const SHELL_LINES = 6;
  const READ_LINES = 6;
  const LIST_LINES = 4;
  const CONTENT_LINES = 3;
  const DIFF_LINES = 2;
  /** No rendered line carries more than this, so one minified line cannot fill the screen. */
  const LINE_CHARS = 240;
  /** A spilled output's path: middle-ellipsized while folded, whole once the body opens. */
  const PATH_CHARS = 46;

  const LABELS: Readonly<Record<string, string>> = {
    [ToolCallStatus.Running]: "Running",
    [ToolCallStatus.Success]: "Done",
    [ToolCallStatus.Error]: "Failed",
  };

  const TONES: Readonly<Record<string, string>> = {
    [ToolCallStatus.Running]: "text-dim",
    [ToolCallStatus.Success]: "text-success",
    [ToolCallStatus.Error]: "text-danger",
  };

  const RAILS: Readonly<Record<string, string>> = {
    [ToolCallStatus.Running]: "border-l-hairline-strong",
    [ToolCallStatus.Success]: "border-l-success/50",
    [ToolCallStatus.Error]: "border-l-danger/60",
  };

  interface DiffLine {
    readonly tone: "removed" | "added";
    readonly text: string;
  }

  interface DiffView {
    readonly lines: readonly DiffLine[];
    readonly hiddenLines: number;
    readonly hiddenEdits: number;
  }

  let openInput = $state(false);
  let openOutput = $state(false);

  const tail = $derived(outputTail(block.output ?? ""));
  const payload = $derived(payloadOf(block));
  const ending = $derived(endingLabel(tail.ending));
  const tone = $derived(TONES[block.status] ?? "text-dim");
  const rail = $derived(RAILS[block.status] ?? "border-l-hairline-strong");
  const running = $derived(block.status === ToolCallStatus.Running);
  const shell = $derived(isShellTool(block.name));
  const list = $derived(isListTool(block.name));
  const read = $derived(block.name === "read");
  const previewLines = $derived(shell ? SHELL_LINES : read ? READ_LINES : LIST_LINES);

  const bodyClip = $derived(clipLines(tail.body, previewLines, LINE_CHARS));
  const bodyShown = $derived(
    openOutput ? clipLines(tail.body, Number.POSITIVE_INFINITY, LINE_CHARS).shown : bodyClip.shown,
  );
  /**
   * The expanded body is one text node, not one element per line: pi caps a shell command at 2000
   * lines, and 2000 paragraphs re-styled on a phone is jank for a view the reader asked to see whole.
   */
  const bodyExpanded = $derived(
    read
      ? bodyShown
          .map((line, index) => `${String(readStart(block) + index).padStart(4)} ${line}`)
          .join("\n")
      : bodyShown.join("\n"),
  );
  const diff = $derived(payload?.kind === "edits" ? diffView(payload.pairs, openInput) : null);
  /** The closed view is what names the fold, which has to stay reachable once it is open. */
  const diffFold = $derived(payload?.kind === "edits" ? diffView(payload.pairs, false) : null);
  const inputHidden = $derived(inputFoldLabel(payload, diffFold));
  const notice = $derived(noticeText(tail.notice, openOutput || bodyClip.hidden === 0));

  /** The whole input on the prompt line: target, window, then every scalar argument. */
  function inputLine(call: ToolCallBlock): string {
    const parts: string[] = [];
    const target = targetOf(call);
    if (target !== "") {
      parts.push(target);
    }
    const window = readWindow(call);
    if (window !== undefined) {
      parts.push(window);
    }
    for (const detail of detailPairs(call)) {
      parts.push(`${detail.key}=${detail.value}`);
    }
    const current = payloadOf(call);
    if (current?.kind === "text") {
      parts.push(`${String(lineCount(current.text))} lines`);
    } else if (current?.kind === "edits") {
      parts.push(
        `${String(current.pairs.length)} ${current.pairs.length === 1 ? "edit" : "edits"}`,
      );
    }
    if (parts.length === 0) {
      return call.status === ToolCallStatus.Running ? "…" : "—";
    }
    return parts.join(" · ");
  }

  function diffView(pairs: readonly EditPair[], open: boolean): DiffView {
    const limit = open ? Number.POSITIVE_INFINITY : DIFF_LINES;
    const lines: DiffLine[] = [];
    let hiddenLines = 0;
    for (const pair of open ? pairs : pairs.slice(0, 1)) {
      const removed = clipLines(pair.oldText, limit, LINE_CHARS);
      const added = clipLines(pair.newText, limit, LINE_CHARS);
      hiddenLines += removed.hidden + added.hidden;
      for (const text of removed.shown) {
        lines.push({ tone: "removed", text });
      }
      for (const text of added.shown) {
        lines.push({ tone: "added", text });
      }
    }
    return {
      lines,
      hiddenLines,
      hiddenEdits: open ? 0 : Math.max(0, pairs.length - 1),
    };
  }

  /** "6 more lines · 1 more edit", or nothing when the input is already whole. */
  function inputFoldLabel(current: ReturnType<typeof payloadOf>, fold: DiffView | null): string {
    const parts: string[] = [];
    if (fold !== null) {
      if (fold.hiddenLines > 0) {
        parts.push(more(fold.hiddenLines, "line", "lines"));
      }
      if (fold.hiddenEdits > 0) {
        parts.push(more(fold.hiddenEdits, "edit", "edits"));
      }
    } else if (current?.kind === "text") {
      const limit = current.label === "content" ? CONTENT_LINES : 0;
      const hidden = clipLines(current.text, limit, LINE_CHARS).hidden;
      if (hidden > 0) {
        parts.push(more(hidden, "line", "lines"));
      }
    }
    return parts.join(" · ");
  }

  function more(count: number, one: string, many: string): string {
    return `${String(count)} more ${count === 1 ? one : many}`;
  }

  /** The output's own noun, so a list of paths is not counted in "lines". */
  function outputNoun(): readonly [string, string] {
    if (block.name === "grep") {
      return ["match", "matches"];
    }
    return isListTool(block.name) ? ["entry", "entries"] : ["line", "lines"];
  }

  function noticeText(
    current: ReturnType<typeof outputTail>["notice"],
    showPathInFull: boolean,
  ): string {
    if (current === null) {
      return "";
    }
    if (current.path === null) {
      return current.text;
    }
    const path = showPathInFull ? current.path : ellipsizeMiddle(current.path, PATH_CHARS);
    return `${current.text} · ${path}`;
  }
</script>

<div
  class={`mb-2 border-l-2 pl-2 text-meta ${rail}`}
  data-testid="tool-card"
  data-tool-status={block.status}
  data-tool-name={block.name}
>
  <div class="flex items-baseline gap-1.5">
    <span class="shrink-0 text-faint" aria-hidden="true">❯</span>
    <span class="shrink-0 font-medium text-ink" data-testid="tool-card-name">{block.name}</span>
    <span class="min-w-0 flex-1 break-words text-dim" data-testid="tool-card-input">
      {inputLine(block)}
    </span>
    <!-- The same in-flight pulse as the run-state row, and for the same reason: the word says it. -->
    <span class={`shrink-0 ${tone}`} class:animate-pulse={running} data-testid="tool-card-status"
      >{LABELS[block.status] ?? block.status}</span
    >
    {#if ending !== ""}
      <span class={`shrink-0 ${tone}`} data-testid="tool-card-ending">· {ending}</span>
    {/if}
  </div>

  <div class="mt-0.5">
    {#if payload?.kind === "edits" && diff !== null}
      <!--
        The code stays ink and only the tint and the marker carry the hue: an added line is not a
        success and a removed line is not a failure, and 11px monospace in a saturated accent is
        harder to read than the same words in the body colour.
      -->
      <div data-testid="tool-card-diff">
        {#each diff.lines as line, index (index)}
          <p
            class={`rounded-sm px-1 whitespace-pre-wrap break-words ${
              line.tone === "removed" ? "bg-danger/10" : "bg-success/10"
            }`}
          >
            <span class={line.tone === "removed" ? "text-danger" : "text-success"}
              >{line.tone === "removed" ? "-" : "+"}</span
            >{line.text}
          </p>
        {/each}
      </div>
    {:else if payload?.kind === "text"}
      {@const clip = clipLines(
        payload.text,
        openInput ? Number.POSITIVE_INFINITY : payload.label === "content" ? CONTENT_LINES : 0,
        LINE_CHARS,
      )}
      <p class="text-faint" data-testid="tool-card-payload-label">
        {payload.label} · {lineCount(payload.text)} lines · {sizeLabel(payload.text)}
      </p>
      {#if payload.label === "content"}
        {#each clip.shown as line, index (index)}
          <p class="text-dim whitespace-pre-wrap break-words">│ {line}</p>
        {/each}
      {:else}
        <pre class="text-dim whitespace-pre-wrap break-words">{clip.shown.join("\n")}</pre>
      {/if}
    {/if}

    {#if inputHidden !== ""}
      <button
        type="button"
        class="flex min-h-11 w-full items-center text-left text-dim"
        onclick={() => {
          openInput = !openInput;
        }}
        data-testid="tool-card-input-fold"
      >
        {openInput ? "⤷ collapse" : `⤷ ${inputHidden}`}
      </button>
    {/if}

    {#if tail.body !== ""}
      <div class="text-dim" data-testid="tool-card-output">
        {#if openOutput}
          <pre class={list ? "break-all" : "whitespace-pre-wrap break-words"}>{bodyExpanded}</pre>
        {:else}
          {#each bodyShown as line, index (index)}
            {#if read}
              <p class="whitespace-pre-wrap break-words">
                <span class="text-faint">{String(readStart(block) + index).padStart(4)}</span>
                {line}
              </p>
            {:else}
              <p class={list ? "break-all" : "whitespace-pre-wrap break-words"}>{line}</p>
            {/if}
          {/each}
        {/if}
      </div>
      {#if bodyClip.hidden > 0}
        <button
          type="button"
          class="flex min-h-11 w-full items-center text-left text-dim"
          onclick={() => {
            openOutput = !openOutput;
          }}
          data-testid="tool-card-output-fold"
        >
          {openOutput ? "⤷ collapse" : `⤷ ${more(bodyClip.hidden, ...outputNoun())}`}
        </button>
      {/if}
    {:else if payload === null && !running}
      <p class="text-faint" data-testid="tool-card-empty">(no output)</p>
    {/if}

    {#if notice !== ""}
      <p class="text-warning" data-testid="tool-card-notice">{notice}</p>
    {/if}
  </div>
</div>
