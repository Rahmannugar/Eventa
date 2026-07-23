export interface TokenBucketRule {
  capacity: number;
  name: string;
  refillIntervalMs: number;
}

export interface SlidingWindowRule {
  limit: number;
  name: string;
  windowMs: number;
}

export interface HybridRateLimitRules {
  primarySlidingWindow: SlidingWindowRule;
  routeKey: string;
  secondarySlidingWindow: SlidingWindowRule;
  tokenBucket: TokenBucketRule;
}

export interface RateLimitDecision {
  allowed: boolean;
  limits: RateLimitSnapshot[];
  retryAfterSeconds: number;
}

export interface RateLimitSnapshot {
  name: string;
  quota: number;
  remaining: number;
  resetAfterSeconds: number;
  windowSeconds: number;
}

export interface AtomicRateLimitAttempt {
  member: string;
  primarySlidingWindowKey: string;
  rules: HybridRateLimitRules;
  secondarySlidingWindowKey?: string;
  tokenBucketKey: string;
}
