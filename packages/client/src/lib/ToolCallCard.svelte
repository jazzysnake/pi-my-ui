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
    clipText,
    detailPairs,
    ellipsizeMiddle,
    endingLabel,
    isListTool,
    kindOf,
    lineCount,
    noticeSummary,
    outputNoun,
    outputTail,
    payloadOf,
    previewLines,
    readStart,
    readWindow,
    sizeLabel,
    targetOf,
    type ClippedText,
    type EditPair,
    type NoticeSummary,
  } from "./tools/call.js";

  let { block }: { block: ToolCallBlock } = $props();

  /** A write's content or an edit's diff: enough to recognise it, not enough to take the screen. */
  const CONTENT_LINES = 3;
  const DIFF_LINES = 2;
  /** No rendered line carries more than this, so one minified line cannot fill the screen. */
  const LINE_CHARS = 240;
  /** A spilled output's path: middle-ellipsized while folded, whole once the body opens. */
  const PATH_CHARS = 46;
  const UNBOUNDED = Number.POSITIVE_INFINITY;

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
    readonly clamped: number;
  }

  let openInput = $state(false);
  let openOutput = $state(false);

  const kind = $derived(kindOf(block.name));
  /** Paths and matches break anywhere; code keeps its word boundaries. */
  const wrapClass = $derived(
    isListTool(block.name) ? "break-all" : "whitespace-pre-wrap break-words",
  );
  const tail = $derived(outputTail(block.output ?? "", { shell: kind === "shell" }));
  const payload = $derived(payloadOf(block));
  const ending = $derived(endingLabel(tail.ending));
  const tone = $derived(TONES[block.status] ?? "text-dim");
  const rail = $derived(RAILS[block.status] ?? "border-l-hairline-strong");
  const running = $derived(block.status === ToolCallStatus.Running);
  const readStartLine = $derived(readStart(block));

  /** Closed and open clips of the same region, so a fold's label never has to re-derive its view. */
  const bodyClosed = $derived(clipLines(tail.body, previewLines(kind), LINE_CHARS));
  const bodyShown = $derived.by(() =>
    openOutput ? clipLines(tail.body, UNBOUNDED, UNBOUNDED).shown : bodyClosed.shown,
  );
  const outputFold = $derived(foldLabel(bodyClosed, outputNoun(kind)));
  const bodyExpanded = $derived(
    kind === "read"
      ? bodyShown.map((line, index) => `${lineNumber(index)} ${line}`).join("\n")
      : bodyShown.join("\n"),
  );
  const notice = $derived(noticeSummary(tail.notices));
  const noticeLine = $derived(noticeText(notice, openOutput || outputFold === ""));

  const payloadLines = $derived(
    payload?.kind === "text" && payload.label === "content" ? CONTENT_LINES : 0,
  );
  const payloadClosed = $derived(
    payload?.kind === "text" ? clipLines(payload.text, payloadLines, LINE_CHARS) : null,
  );
  const payloadShown = $derived.by((): readonly string[] => {
    if (payload?.kind !== "text" || payloadClosed === null) {
      return [];
    }
    return openInput ? clipLines(payload.text, UNBOUNDED, UNBOUNDED).shown : payloadClosed.shown;
  });

  const diffClosed = $derived(payload?.kind === "edits" ? diffView(payload.pairs, false) : null);
  const diffShown = $derived.by((): readonly DiffLine[] => {
    if (payload?.kind !== "edits") {
      return [];
    }
    return (openInput ? diffView(payload.pairs, true) : diffClosed)?.lines ?? [];
  });
  const inputFold = $derived(
    diffClosed === null
      ? payloadClosed === null
        ? ""
        : foldLabel(payloadClosed, ["line", "lines"])
      : diffFoldLabel(diffClosed),
  );

  function diffView(pairs: readonly EditPair[], open: boolean): DiffView {
    const lineLimit = open ? UNBOUNDED : DIFF_LINES;
    const charLimit = open ? UNBOUNDED : LINE_CHARS;
    const lines: DiffLine[] = [];
    let hiddenLines = 0;
    let clamped = 0;
    for (const pair of open ? pairs : pairs.slice(0, 1)) {
      const removed = clipLines(pair.oldText, lineLimit, charLimit);
      const added = clipLines(pair.newText, lineLimit, charLimit);
      hiddenLines += removed.hidden + added.hidden;
      clamped += removed.clamped + added.clamped;
      for (const text of removed.shown) {
        lines.push({ tone: "removed", text });
      }
      for (const text of added.shown) {
        lines.push({ tone: "added", text });
      }
    }
    return { lines, hiddenLines, hiddenEdits: open ? 0 : Math.max(0, pairs.length - 1), clamped };
  }

  /** "6 more lines · 2 lines cut short · 1 more edit", or nothing when the region is whole. */
  function foldLabel(clip: ClippedText, noun: readonly [string, string]): string {
    const parts: string[] = [];
    if (clip.hidden > 0) {
      parts.push(`${String(clip.hidden)} more ${clip.hidden === 1 ? noun[0] : noun[1]}`);
    }
    if (clip.clamped > 0) {
      parts.push(`${String(clip.clamped)} ${clip.clamped === 1 ? "line" : "lines"} cut short`);
    }
    return parts.join(" · ");
  }

  function diffFoldLabel(view: DiffView): string {
    const parts: string[] = [];
    if (view.hiddenLines > 0) {
      parts.push(`${String(view.hiddenLines)} more ${view.hiddenLines === 1 ? "line" : "lines"}`);
    }
    if (view.clamped > 0) {
      parts.push(`${String(view.clamped)} ${view.clamped === 1 ? "line" : "lines"} cut short`);
    }
    if (view.hiddenEdits > 0) {
      parts.push(`${String(view.hiddenEdits)} more ${view.hiddenEdits === 1 ? "edit" : "edits"}`);
    }
    return parts.join(" · ");
  }

  /** The whole input on the prompt line: target, window, then every scalar argument. */
  function inputLine(call: ToolCallBlock): string {
    const parts: string[] = [];
    const target = clipText(targetOf(call), LINE_CHARS);
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
      return running ? "…" : "";
    }
    return parts.join(" · ");
  }

  /** A read's preview numbers itself from the line pi started reading at. */
  function lineNumber(index: number): string {
    return String(readStartLine + index).padStart(4);
  }

  function noticeText(current: NoticeSummary, showPathInFull: boolean): string {
    if (current.text === "") {
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
    {#if payload?.kind === "edits"}
      <!--
        The code stays ink and only the tint and the marker carry the hue: an added line is not a
        success and a removed line is not a failure, and 11px monospace in a saturated accent is
        harder to read than the same words in the body colour.
      -->
      <div data-testid="tool-card-diff">
        {#each diffShown as line, index (index)}
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
      <p class="text-faint" data-testid="tool-card-payload-label">
        {payload.label} · {lineCount(payload.text)} lines · {sizeLabel(payload.text)}
      </p>
      {#if payload.label === "content"}
        {#each payloadShown as line, index (index)}
          <p class="text-dim whitespace-pre-wrap break-words">│ {line}</p>
        {/each}
      {:else}
        <pre class="text-dim whitespace-pre-wrap break-words">{payloadShown.join("\n")}</pre>
      {/if}
    {/if}

    {#if inputFold !== ""}
      <button
        type="button"
        class="flex min-h-11 w-full items-center text-left text-dim"
        onclick={() => {
          openInput = !openInput;
        }}
        data-testid="tool-card-input-fold"
      >
        {openInput ? "⤷ collapse" : `⤷ ${inputFold}`}
      </button>
    {/if}

    {#if tail.body !== ""}
      <div class="text-dim" data-testid="tool-card-output">
        {#if openOutput}
          <pre class={wrapClass}>{bodyExpanded}</pre>
        {:else}
          {#each bodyShown as line, index (index)}
            {#if kind === "read"}
              <p class={wrapClass}>
                <span class="text-faint">{lineNumber(index)}</span>
                {line}
              </p>
            {:else}
              <p class={wrapClass}>{line}</p>
            {/if}
          {/each}
        {/if}
      </div>
      {#if outputFold !== ""}
        <button
          type="button"
          class="flex min-h-11 w-full items-center text-left text-dim"
          onclick={() => {
            openOutput = !openOutput;
          }}
          data-testid="tool-card-output-fold"
        >
          {openOutput ? "⤷ collapse" : `⤷ ${outputFold}`}
        </button>
      {/if}
    {:else if payload === null && !running}
      <p class="text-faint" data-testid="tool-card-empty">(no output)</p>
    {/if}

    {#if noticeLine !== ""}
      <p class="text-warning" data-testid="tool-card-notice">{noticeLine}</p>
    {/if}
  </div>
</div>
