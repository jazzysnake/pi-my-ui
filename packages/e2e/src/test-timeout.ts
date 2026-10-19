/**
 * One per-test timeout for the browser suite, declared once and read by the Playwright config, so no
 * spec can negotiate its own and a hang costs 45 seconds instead of two minutes. Forty-five is
 * roughly four times the slowest real path in the suite, which is why it absorbs a loaded machine
 * without flaking.
 */
export const BROWSER_TEST_TIMEOUT_MS = 45_000;
