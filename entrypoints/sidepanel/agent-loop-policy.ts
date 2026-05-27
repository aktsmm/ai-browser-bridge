import type { OperationMode } from "./types";

export const SCREENSHOT_FALLBACK_ERROR_THRESHOLD = 3;
export const FATAL_AUTONOMOUS_ERROR_THRESHOLD = 5;

type LoopErrorPolicyInput = {
  operationMode: OperationMode;
  useScreenshotFallback: boolean;
  consecutiveFailedActionLoops: number;
};

export function shouldEnableScreenshotFallback(
  operationMode: OperationMode,
  consecutiveErrors: number,
  useScreenshotFallback: boolean,
): boolean {
  return (
    operationMode === "hybrid" &&
    consecutiveErrors >= SCREENSHOT_FALLBACK_ERROR_THRESHOLD &&
    !useScreenshotFallback
  );
}

export function shouldStopAutonomousLoopAfterFailures({
  operationMode,
  useScreenshotFallback,
  consecutiveFailedActionLoops,
}: LoopErrorPolicyInput): boolean {
  if (consecutiveFailedActionLoops < FATAL_AUTONOMOUS_ERROR_THRESHOLD) {
    return false;
  }

  return operationMode !== "hybrid" || useScreenshotFallback;
}
