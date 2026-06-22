import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

/**
 * Validación del path parameter `orgId` en endpoints que lo aceptan.
 *
 * Usado en:
 * - GET    /providers/:orgId
 * - DELETE /auth/:orgId
 */
export class OrgIdParamDto {
  @ApiProperty({
    description: 'UUID del grupo/org',
    format: 'uuid',
    example: '11111111-1111-1111-1111-111111111111',
  })
  @IsString()
  @IsNotEmpty()
  @IsUUID('4', { message: 'orgId debe ser un UUID válido' })
  orgId: string;
}

/**
 * Validación del path parameter `id` (genérico para fileId).
 *
 * Usado en: GET /files/:id/url
 */
export class FileIdParamDto {
  @ApiProperty({
    description: 'UUID del archivo en file_references',
    format: 'uuid',
  })
  @IsString()
  @IsNotEmpty()
  @IsUUID('4', { message: 'id debe ser un UUID válido' })
  id: string;
}
