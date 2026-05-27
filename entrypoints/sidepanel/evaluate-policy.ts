export const DIRECT_EVALUATE_DISABLED_REASON =
  "Direct evaluate action is disabled for security. Use explicit browser actions or Playwright tools instead.";

export function getEvaluateBlockedMessage(): string {
  return `Evaluate blocked: ${DIRECT_EVALUATE_DISABLED_REASON}`;
}