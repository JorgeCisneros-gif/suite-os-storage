import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { VALID_APP_SOURCES, AppSource } from '../../common/app-sources';

/**
 * Query params para endpoints que requieren identificar la app cliente.
 *
 * Usado en:
 * - GET /providers/:orgId?appSource=...
 * - GET /auth/google/connect?orgId=...&appSource=...
 * - DELETE /auth/:orgId?appSource=...
 */
export class AppSourceQueryDto {
  @ApiProperty({
    description: 'App cliente que hace la petición',
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
