import { readFileSync } from "node:fs";

import type { AssistantMessage, TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { assertExpectation, lastModelVisibleMessage } from "./match.js";
import { ScriptError, parseScript, type Script, type ScriptStep } from "./script.js";

export {
  parseScript,
  ScriptError,
  type Script,
  type ScriptedBlock,
  type ScriptedReply,
  type ScriptExpectation,
  type ScriptStep,
} from "./script.js";

/** Names the script file the provider replays. The harness sets it on each hermetic pi child. */
export const SCRIPT_ENV_VAR = "PI_MY_UI_SCRIPT";
export const SCRIPTED_PROVIDER_ID = "scripted";
export const SCRIPTED_MODEL_ID = "scripted";

type LoadedScript =
  { readonly ok: true; readonly script: Script } | { readonly ok: false; readonly error: string };

function loadScript(): LoadedScript {
  const path = process.env[SCRIPT_ENV_VAR];
  if (path === undefined || path === "") {
    return { ok: false, error: `scripted provider: ${SCRIPT_ENV_VAR} is not set` };
  }
  try {
    return { ok: true, script: parseScript(readFileSync(path, "utf8"), path) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function replyFor(step: ScriptStep, context: TranscriptContext): AssistantMessage {
  assertExpectation(step.expect, lastModelVisibleMessage(context.messages));
  return fauxAssistantMessage([...step.reply.content], { stopReason: step.reply.stopReason });
}

/**
 * Load pi with a scriptable model instead of a real provider.
 *
 * The script is read at load time and a broken one is kept as an error so that the failure surfaces
 * on the first model call, where a test can see it, rather than as an extension-load warning that
 * leaves pi running without a provider.
 */
export default function registerScriptedProvider(pi: ExtensionAPI): void {
  const loaded = loadScript();
  const steps = loaded.ok ? loaded.script : [];

  const faux = fauxProvider({
    provider: SCRIPTED_PROVIDER_ID,
    models: [
      {
        id: SCRIPTED_MODEL_ID,
        name: "Scripted model",
        reasoning: false,
        input: ["text"],
        contextWindow: 200_000,
        maxTokens: 8_192,
      },
    ],
  });

  const exhaustionMessage = loaded.ok
    ? "scripted provider: the script has no reply for this model call"
    : loaded.error;
  faux.setResponses([
    ...steps.map((step) => (context: TranscriptContext) => replyFor(step, context)),
    () => {
      throw new ScriptError(exhaustionMessage);
    },
  ]);

  pi.registerProvider(faux.provider);
}
