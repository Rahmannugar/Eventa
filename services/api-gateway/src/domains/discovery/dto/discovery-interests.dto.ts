import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SetAttendeeInterestsDto {
  @ApiProperty({
    description: 'What the attendee wants to hear about',
    type: [String],
    maxItems: 50,
    maxLength: 64,
    example: ['music', 'jazz', 'workshops'],
  })
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(64, { each: true })
  interests!: string[];
}

export class AttendeeInterestsDto {
  @ApiProperty({ type: [String], example: ['music', 'jazz'] })
  interests!: string[];

  @ApiPropertyOptional({
    description: 'When these interests were last saved',
    example: '2026-09-29T00:05:33Z',
  })
  updatedAt?: string | undefined;
}
