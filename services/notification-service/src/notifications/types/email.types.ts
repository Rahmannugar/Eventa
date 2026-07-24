export interface EmailDeliveryRequest {
  from: string;
  html: string;
  idempotencyKey: string;
  subject: string;
  text: string;
  to: string;
}

export interface EmailDeliveryResult {
  messageId: string;
}
