import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { RabbitMQClient } from '../../../infrastructure/clients/rabbitmq.client';
import {
  EVENT_CANCELLATION_EMAIL_EXCHANGE,
  EVENT_CANCELLATION_EMAIL_QUEUE,
} from '../../constants/cancellation-email.constants';

@Injectable()
export class EventCancellationEmailQueueTopology implements OnModuleInit {
  private readonly logger = new Logger(
    EventCancellationEmailQueueTopology.name,
  );

  constructor(
    @Inject(RabbitMQClient)
    private readonly rabbitMQ: RabbitMQClient,
  ) {}

  async onModuleInit(): Promise<void> {
    const channel = await this.rabbitMQ.confirmChannel(
      'event-cancellation-email-topology',
    );

    await channel.assertExchange(EVENT_CANCELLATION_EMAIL_EXCHANGE, 'direct', {
      durable: true,
    });
    await channel.assertQueue(EVENT_CANCELLATION_EMAIL_QUEUE, {
      durable: true,
      arguments: { 'x-delivery-limit': -1, 'x-queue-type': 'quorum' },
    });
    await channel.bindQueue(
      EVENT_CANCELLATION_EMAIL_QUEUE,
      EVENT_CANCELLATION_EMAIL_EXCHANGE,
      EVENT_CANCELLATION_EMAIL_QUEUE,
    );

    this.logger.log({
      event: 'event_cancellation_email_queue_ready',
      exchange: EVENT_CANCELLATION_EMAIL_EXCHANGE,
      queue_name: EVENT_CANCELLATION_EMAIL_QUEUE,
    });
  }
}
