/** One readable sentence for an unknown failure, so every refusal names its cause the same way. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
