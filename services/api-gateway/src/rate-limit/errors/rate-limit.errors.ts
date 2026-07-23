export class RateLimitStateUnavailableError extends Error {
  constructor() {
    super('Rate limit state unavailable');
    this.name = 'RateLimitStateUnavailableError';
  }
}
