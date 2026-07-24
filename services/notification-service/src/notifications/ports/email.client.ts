export interface SendEmail {
  from: string;
  html: string;
  idempotencyKey: string;
  subject: string;
  text: string;
  to: string;
}

export interface EmailClient {
  send(email: SendEmail): Promise<{ messageId: string }>;
}
