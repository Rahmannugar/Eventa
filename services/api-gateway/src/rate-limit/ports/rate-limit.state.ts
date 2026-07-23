import type {
  AtomicRateLimitAttempt,
  RateLimitDecision,
} from '../types/rate-limit.types';

export interface RateLimitState {
  consume(attempt: AtomicRateLimitAttempt): Promise<RateLimitDecision>;
}
