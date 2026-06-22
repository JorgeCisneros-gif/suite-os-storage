import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

/**
 * Query params para obtener URL de descarga de un archivo.
 *
 * Usado en: GET /files/:id/url?orgId=...
 *
 * Necesitamos el orgId además del fileId porque las credenciales
 * de Drive (si aplica) están asociadas al orgId+appSource. El
 * appSource lo deducimos del file_reference en DB.
 */
export class GetDownloadUrlQueryDto {
  @ApiProperty({
    description: 'UUID del grupo dueño del archivo',
    format: 'uuid',
    example: '11111111-1111-1111-1111-111111111111',
  })
  @IsString()
  @IsNotEmpty({ message: 'orgId es requerido' })
  @IsUUID('4', { message: 'orgId debe ser un UUID válido' })
  orgId: string;
}
