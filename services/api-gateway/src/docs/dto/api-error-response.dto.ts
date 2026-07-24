import { ApiProperty } from '@nestjs/swagger';

export class ApiValidationErrorDto {
  @ApiProperty({ example: 'TOO_SHORT' })
  code!: string;

  @ApiProperty({ example: 'password' })
  field!: string;

  @ApiProperty({ example: 'Password must be at least 8 characters.' })
  message!: string;
}

export class ApiErrorResponseDto {
  @ApiProperty({ example: 'VALIDATION_FAILED' })
  code!: string;

  @ApiProperty({
    example: 'Check the highlighted fields and try again.',
  })
  message!: string;

  @ApiProperty({ example: 422 })
  statusCode!: number;

  @ApiProperty({ required: false, type: [ApiValidationErrorDto] })
  errors?: ApiValidationErrorDto[];
}
