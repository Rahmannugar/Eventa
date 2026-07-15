import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({ example: 'api-gateway' })
  service!: 'api-gateway';

  @ApiProperty({ example: 'ok' })
  status!: 'ok';
}
