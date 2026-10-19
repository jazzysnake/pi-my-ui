import { expect, test } from "@playwright/test";

import {
  providerCredential,
  providerCredentialEnv,
  recordRun,
} from "@pi-my-ui/scripted-provider/record";

import { createHermeticHome, hermeticPiEnv, startScriptedPi } from "../src/pi-harness";

/**
 * Opt-in real-provider smoke check, outside `npm run verify:full`.
 *
 * It records a real model-provider run and then replays that recording through the scripted
 * provider: if the recording cannot stand in for the run that produced it, the scripts have drifted
 * away from reality and the deterministic suite is testing fiction. It needs real credentials, so a
 * checkout without them skips with the exact variables to set.
 */

const PROVIDER = process.env["PI_MY_UI_SMOKE_PROVIDER"] ?? "anthropic";
const MODEL = process.env["PI_MY_UI_SMOKE_MODEL"] ?? "claude-sonnet-4-5";
const PROMPT = "Reply with the single word: smoke";

const SKIP_REASON =
  `real-provider smoke is opt-in: set ${providerCredentialEnv(PROVIDER).join(" or ")} ` +
  `for provider ${PROVIDER} (model ${MODEL}), then run npm run test:smoke`;

const HAS_CREDENTIALS = providerCredential(PROVIDER, process.env) !== undefined;
if (!HAS_CREDENTIALS) {
  console.warn(`[real-provider smoke] SKIPPED - ${SKIP_REASON}`);
}
test.skip(!HAS_CREDENTIALS, SKIP_REASON);

test.describe.configure({ timeout: 120_000 });

/** Only the credential variables a real provider reads; the developer's other environment stays out. */
function credentialEnv(provider: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of providerCredentialEnv(provider)) {
    const value = process.env[name];
    if (value !== undefined && value !== "") {
      env[name] = value;
    }
  }
  return env;
}

test("records a real-provider run whose recording the scripted provider replays", async () => {
  const home = await createHermeticHome();
  try {
    const recorded = await recordRun({
      prompts: [PROMPT],
      provider: PROVIDER,
      model: MODEL,
      cwd: home.workspace,
      env: hermeticPiEnv(home, credentialEnv(PROVIDER)),
    });
    expect(recorded.length).toBeGreaterThan(0);

    const pi = await startScriptedPi({ home, script: recorded });
    try {
      const turn = await pi.prompt(PROMPT);
      expect(turn.replies.length).toBeGreaterThan(0);
      expect(turn.replies.at(-1)?.stopReason).toBe("stop");
    } finally {
      await pi.stop();
    }
  } finally {
    await home.dispose();
  }
});
