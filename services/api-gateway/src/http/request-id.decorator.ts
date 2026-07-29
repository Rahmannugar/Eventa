import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

interface RequestWithId {
  headers: {
    'x-request-id'?: string;
  };
}

export const RequestId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<RequestWithId>();
    const requestId = request.headers['x-request-id'];

    if (requestId === undefined) {
      throw new Error('Request ID middleware did not run.');
    }

    return requestId;
  },
);
