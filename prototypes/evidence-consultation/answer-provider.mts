import type { CandidateAnswer } from "./answer-contract.ts";
import type { AnswerPacket } from "./answer-policy.mts";
import { validateCandidate } from "./answer-policy.mts";

/**
 * A test-injected transport only. There is deliberately no provider registry,
 * SDK import, network call, environment lookup, or runtime fallback here.
 * Resolving this promise is the transport's complete buffered response; streamed
 * or partial responses are not accepted for display.
 */
export interface CandidateProvider {
  execute(packet: AnswerPacket, options: { signal: AbortSignal }): Promise<unknown>;
}

/**
 * Placeholder gate for a future real adapter. No real adapter exists here:
 * before one can be introduced, an independently recorded privacy review must
 * be verified by its integration boundary. A packet question may contain PII.
 */
export interface PrivacyReviewedPermit {
  kind: "privacy_review";
  reviewed: true;
}

export const REAL_ADAPTER_PRIVACY_REVIEW_TODO = true;

export interface ExecuteCandidateOptions {
  signal?: AbortSignal;
  /** Bounded to avoid a caller creating an unbounded pending provider call. */
  timeoutMs?: number;
}

export class CandidateExecutionError extends Error {
  constructor(
    public readonly code: "cancelled" | "timeout" | "provider_error" | "partial" | "rejected",
  ) {
    super(code);
    this.name = "CandidateExecutionError";
  }
}

/** Future real-adapter boundaries must call this before any transmission. */
export function requirePrivacyReviewedForRealAdapter(
  permit: PrivacyReviewedPermit | undefined,
): asserts permit is PrivacyReviewedPermit {
  if (!permit || permit.kind !== "privacy_review" || permit.reviewed !== true) {
    throw new CandidateExecutionError("provider_error");
  }
}

function timeoutFor(value: number | undefined) {
  if (value === undefined) return 10_000;
  if (!Number.isSafeInteger(value) || value < 1 || value > 30_000) {
    throw new CandidateExecutionError("timeout");
  }
  return value;
}

/**
 * Runs only an explicitly supplied mock transport, buffers its complete promise,
 * then validates the candidate before returning it. No partial provider output
 * is exposed. Provider errors are intentionally reduced to a fixed code.
 */
export async function executeCandidate(
  provider: CandidateProvider,
  packet: AnswerPacket,
  options: ExecuteCandidateOptions = {},
): Promise<CandidateAnswer> {
  if (!provider || typeof provider.execute !== "function") throw new CandidateExecutionError("provider_error");
  if (options.signal?.aborted) throw new CandidateExecutionError("cancelled");
  const timeoutMs = timeoutFor(options.timeoutMs);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const completion = Promise.resolve()
      .then(() => provider.execute(packet, { signal: controller.signal }))
      .catch(() => {
        throw new CandidateExecutionError("provider_error");
      });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new CandidateExecutionError("timeout"));
        // Reject timeout first: abort listeners are synchronous, and otherwise
        // the cancellation race could incorrectly hide a timeout reason.
        controller.abort();
      }, timeoutMs);
    });
    const cancelled = new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () => reject(new CandidateExecutionError("cancelled")), { once: true });
    });
    const candidate = await Promise.race([completion, timeout, cancelled]);
    if (controller.signal.aborted) throw new CandidateExecutionError("cancelled");
    // A provider envelope that admits incompleteness is never treated as a
    // candidate. Direct values are complete only because the Promise resolved.
    if (candidate && typeof candidate === "object" && "complete" in candidate
      && (candidate as { complete?: unknown }).complete !== true) {
      throw new CandidateExecutionError("partial");
    }
    const value = candidate && typeof candidate === "object" && "candidate" in candidate
      && (candidate as { complete?: unknown }).complete === true
      ? (candidate as { candidate: unknown }).candidate
      : candidate;
    const validated = validateCandidate(value, packet);
    if (!validated.ok) throw new CandidateExecutionError("rejected");
    return validated.value;
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}