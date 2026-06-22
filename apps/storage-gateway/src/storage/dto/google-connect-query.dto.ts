import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { VALID_APP_SOURCES, AppSource } from '../../common/app-sources';

/**
 * Query params para iniciar el flujo OAuth de Google Drive.
 *
 * Usado en: GET /auth/google/connect?orgId=...&appSource=...
 */
export class GoogleConnectQueryDto {
  @ApiProperty({
    description: 'UUID del grupo/org que conectará su Drive',
    format: 'uuid',
    example: '11111111-1111-1111-1111-111111111111',
  })
  @IsString()
  @IsNotEmpty({ message: 'orgId es requerido' })
  @IsUUID('4', { message: 'orgId debe ser un UUID válido' })
  orgId: string;

  @ApiProperty({
    description: 'App cliente que está conectando el Drive',
    enum: VALID_APP_SOURCES,
    example: 'departmentos',
  })
  @IsString()
  @IsNotEmpty({ message: 'appSource es requerido' })
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase().trim() : value))
  @IsIn(VALID_APP_SOURCES as unknown as string[], {
    message: `appSource debe ser uno de: ${VALID_APP_SOURCES.join(', ')}`,
  })
  appSource: AppSource;
}
