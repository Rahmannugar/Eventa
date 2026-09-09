import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID } from 'class-validator';

export class AdminTicketCheckInPathDto {
  @ApiProperty() @IsUUID() eventId!: string;
}

export class AdminTicketCheckInDto {
  @ApiProperty() @IsString() qrToken!: string;
}

export class AdminTicketCheckInResponseDto {
  @ApiProperty() ticketId!: string;
  @ApiProperty() eventId!: string;
  @ApiProperty() checkedInAt!: string;
  @ApiProperty() alreadyCheckedIn!: boolean;
}
