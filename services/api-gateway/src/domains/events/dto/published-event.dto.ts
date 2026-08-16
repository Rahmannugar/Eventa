import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class PublishedEventPathDto {
  @IsUUID()
  eventId!: string;
}

export class PublishedEventVenueDto {
  @ApiProperty()
  name!: string;

  @ApiProperty()
  addressLine1!: string;

  @ApiPropertyOptional()
  addressLine2?: string;

  @ApiProperty()
  city!: string;

  @ApiPropertyOptional()
  region?: string;

  @ApiPropertyOptional()
  postalCode?: string;

  @ApiProperty()
  countryCode!: string;
}

export class PublishedEventMediaDto {
  @ApiProperty()
  mediaId!: string;

  @ApiProperty({
    enum: ['cover', 'gallery_1', 'gallery_2', 'gallery_3', 'gallery_4'],
  })
  slot!: 'cover' | 'gallery_1' | 'gallery_2' | 'gallery_3' | 'gallery_4';

  @ApiProperty()
  url!: string;

  @ApiProperty({ enum: ['image/jpeg', 'image/png', 'image/webp'] })
  contentType!: 'image/jpeg' | 'image/png' | 'image/webp';

  @ApiProperty()
  sizeBytes!: number;

  @ApiProperty()
  width!: number;

  @ApiProperty()
  height!: number;
}

export class PublishedEventDto {
  @ApiProperty()
  eventId!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty()
  categories!: string[];

  @ApiProperty()
  startsAt!: string;

  @ApiProperty()
  endsAt!: string;

  @ApiProperty()
  timeZone!: string;

  @ApiProperty({ type: PublishedEventVenueDto })
  venue!: PublishedEventVenueDto;

  @ApiProperty({ type: () => [PublishedEventMediaDto] })
  media!: PublishedEventMediaDto[];

  @ApiProperty()
  publishedAt!: string;

  @ApiProperty({ minimum: 2 })
  version!: number;
}
