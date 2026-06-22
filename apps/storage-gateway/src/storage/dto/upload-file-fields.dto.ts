import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import {
  VALID_APP_SOURCES, AppSource, ENTITY_TYPE_REGEX,
} from '../../common/app-sources';

/**
 * Validación de los CAMPOS del multipart en POST /files/upload.
 *
 * No es un DTO que NestJS valide automáticamente — los campos
 * vienen de `req.parts()` (Fastify multipart), así que se valida
 * MANUALMENTE en el controller con `validateOrReject(plainToInstance(...))`.
 *
 * Razón: el body multipart no es JSON, no se puede aplicar
 * `@Body() dto: UploadFileFieldsDto` directamente.
 *
 * El campo `file` (archivo binario) NO está aquí — se valida aparte
 * en el controller (existencia, mimeType, tamaño).
 */
export class UploadFileFieldsDto {
  @ApiProperty({
    description: 'UUID del grupo/org dueño del archivo',
    format: 'uuid',
    example: '11111111-1111-1111-1111-111111111111',
  })
  @IsString()
  @IsNotEmpty({ message: 'orgId es requerido' })
  @IsUUID('4', { message: 'orgId debe ser un UUID válido' })
  orgId: string;

  @ApiProperty({
    description: 'App cliente que sube el archivo',
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

  @ApiProperty({
    description: 'Tipo de entidad a la que pertenece el archivo (snake_case, max 50)',
    example: 'meter_reading',
    pattern: '^[a-z][a-z0-9_]{0,49}$',
  })
  @IsString()
  @IsNotEmpty({ message: 'entityType es requerido' })
  @Matches(ENTITY_TYPE_REGEX, {
    message:
      'entityType debe ser snake_case (lowercase, dígitos, underscores, max 50 chars). ' +
      'Ejemplos: meter_reading, receipt, product_photo',
  })
  entityType: string;

  @ApiPropertyOptional({
    description: 'UUID opcional de la entidad específica',
    format: 'uuid',
    example: '22222222-2222-2222-2222-222222222222',
  })
  @IsOptional()
  @IsString()
  @IsUUID('4', { message: 'entityId debe ser un UUID válido si se proporciona' })
  entityId?: string;

  @ApiPropertyOptional({
    description: 'Subcarpeta dentro de la raíz en Drive (max 100 chars, sin slashes)',
    example: 'Lecturas',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'subFolder no puede exceder 100 caracteres' })
  @Matches(/^[^/\\]+$/, {
    message: 'subFolder no puede contener / ni \\',
  })
  subFolder?: string;

  @ApiPropertyOptional({
    description:
      'Nombre custom para el archivo (sin extensión). Si no se envía, se usa el filename original. ' +
      'Max 200 chars. La extensión se preserva automáticamente del archivo original.',
    example: 'lectura_dept101_jun2026',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'customFileName no puede exceder 200 caracteres' })
  @Matches(/^[^/\\:*?"<>|]+$/, {
    message: 'customFileName no puede contener caracteres reservados: / \\ : * ? " < > |',
  })
  customFileName?: string;
}
