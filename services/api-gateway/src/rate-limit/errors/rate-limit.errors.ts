export class RateLimitStoreUnavailableError extends Error {
  constructor() {
    super('Rate limit store unavailable');
    this.name = 'RateLimitStoreUnavailableError';
  }
}
