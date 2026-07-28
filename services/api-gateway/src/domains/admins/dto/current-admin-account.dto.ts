import type { GetCurrentAdminAccountResponse } from '@eventa/grpc-contracts';
import { ApiProperty } from '@nestjs/swagger';

export class CurrentAdminAccountDto implements GetCurrentAdminAccountResponse {
  @ApiProperty({ example: 'f3c1ab8f-b445-41f5-9d87-c434ae7fe223' })
  adminId!: string;

  @ApiProperty({ example: 'admin@example.com' })
  email!: string;
}
