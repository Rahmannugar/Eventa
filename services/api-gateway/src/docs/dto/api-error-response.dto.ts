import { ApiProperty } from '@nestjs/swagger';

export class ApiErrorResponseDto {
  @ApiProperty({ example: 'Conflict' })
  error!: string;

  @ApiProperty({
    oneOf: [
      { example: 'EMAIL_ALREADY_REGISTERED', type: 'string' },
      {
        example: ['email must be an email'],
        items: { type: 'string' },
        type: 'array',
      },
    ],
  })
  message!: string | string[];

  @ApiProperty({ example: 409 })
  statusCode!: number;
}
