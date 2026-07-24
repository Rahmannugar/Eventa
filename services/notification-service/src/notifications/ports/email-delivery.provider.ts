import type {
  EmailDeliveryRequest,
  EmailDeliveryResult,
} from '../types/email.types';

export interface EmailDeliveryProvider {
  send(email: EmailDeliveryRequest): Promise<EmailDeliveryResult>;
}
