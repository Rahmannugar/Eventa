import { IsUUID } from 'class-validator';

export class GetAttendeeContactDto {
  @IsUUID()
  attendeeId!: string;
}
