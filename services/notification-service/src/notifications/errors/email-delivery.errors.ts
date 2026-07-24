export class EmailDeliveryError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = EmailDeliveryError.name;
  }
}
