import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateDraftEventDto {
  @ApiProperty({ example: 'Lagos Design Week', maxLength: 160 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;
}

export class AdminEventPathDto {
  @IsUUID()
  eventId!: string;
}

export class AdminEventDto {
  @ApiProperty({ example: '8b3856cc-040d-4584-a952-412028d2b600' })
  eventId!: string;

  @ApiProperty({ example: 'Lagos Design Week' })
  title!: string;

  @ApiProperty({ enum: ['draft'], example: 'draft' })
  status!: 'draft';

  @ApiProperty({ example: '81c30c75-d16b-469b-a7c5-20e8973f1b9a' })
  createdByAdminId!: string;

  @ApiProperty({ example: '2026-07-30T10:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-07-30T10:00:00.000Z' })
  updatedAt!: string;
}
