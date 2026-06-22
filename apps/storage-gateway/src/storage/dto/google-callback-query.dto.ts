import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

/**
 * Query params del callback de Google OAuth.
 *
 * Usado en: GET /auth/google/callback?code=...&state=...
 *
 * Google envía estos params automáticamente después de que el
 * usuario acepta los permisos.
 */
export class GoogleCallbackQueryDto {
  @ApiProperty({
    description: 'Código de autorización entregado por Google',
    example: '4/0AY0e-g7...',
  })
  @IsString()
  @IsNotEmpty({ message: 'code es requerido' })
  code: string;

  @ApiProperty({
    description: 'State base64 con orgId y appSource (generado por nuestro connect)',
    example: 'eyJvcmdJZCI6IjExMTExMTExLTExMTEtMTExMS0xMTExLTExMTExMTExMTExMSIsImFwcFNvdXJjZSI6ImRlcGFydG1lbnRvcyJ9',
  })
  @IsString()
  @IsNotEmpty({ message: 'state es requerido' })
  @Matches(/^[A-Za-z0-9+/=]+$/, { message: 'state debe ser base64 válido' })
  state: string;
}
