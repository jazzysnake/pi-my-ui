/** Props that stay live after mount, so a test can move a mounted component's input. */
export function liveProps(initial: Record<string, unknown>): Record<string, unknown> {
  const props = $state(initial);
  return props;
}
