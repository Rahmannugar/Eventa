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

export interface AttendeeRegistrationRateLimitRules {
  identitySlidingWindow: SlidingWindowRule;
  ipSlidingWindow: SlidingWindowRule;
  routeKey: string;
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

export interface RegistrationRateLimitAttempt {
  clientIp: string;
  email?: string;
}

export interface AtomicRateLimitAttempt {
  identityKey?: string;
  ipSlidingWindowKey: string;
  member: string;
  rules: AttendeeRegistrationRateLimitRules;
  tokenBucketKey: string;
}

export interface RateLimitStore {
  consume(attempt: AtomicRateLimitAttempt): Promise<RateLimitDecision>;
}

export interface RateLimitRedisClient {
  readonly isOpen: boolean;
  readonly isReady: boolean;
  close(): Promise<void>;
  connect(): Promise<unknown>;
  eval(
    script: string,
    options: { arguments: string[]; keys: string[] },
  ): Promise<unknown>;
  on(event: 'error', listener: (error: Error) => void): unknown;
}
