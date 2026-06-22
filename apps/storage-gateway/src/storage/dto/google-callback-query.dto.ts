import { IsOptional, IsString } from 'class-validator';

/**
 * Query params que llegan al endpoint /auth/google/callback.
 *
 * Google redirige al callback con estos parámetros estándar de OAuth 2.0:
 * - `code`: código de autorización (intercambiable por tokens)
 * - `state`: JWT firmado que enviamos al iniciar el flujo (contiene orgId, appSource)
 * - `error`: si el usuario rechazó la autorización
 * - `error_description`: detalle del error
 *
 * Además Google agrega propiedades EXTRA al callback que no usamos pero
 * que vienen en el query string. Las declaramos como opcionales para que
 * el ValidationPipe global (con forbidNonWhitelisted: true) no las rechace:
 * - `scope`: scopes que el usuario aprobó
 * - `authuser`: índice de la cuenta Google usada (cuando hay varias logueadas)
 * - `prompt`: cómo se mostró la pantalla de consentimiento ("consent", "none", etc.)
 * - `iss`: issuer de los tokens (https://accounts.google.com)
 * - `session_state`: estado de sesión OAuth
 * - `hd`: hosted domain (cuentas de Google Workspace)
 */
export class GoogleCallbackQueryDto {
  // ── Parámetros que SÍ usamos ──────────────────────────────
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  error?: string;

  @IsOptional()
  @IsString()
  error_description?: string;

  // ── Parámetros que Google AGREGA y debemos aceptar ────────
  // No los usamos en lógica de negocio, pero deben pasar validación.

  @IsOptional()
  @IsString()
  scope?: string;

  @IsOptional()
  @IsString()
  authuser?: string;

  @IsOptional()
  @IsString()
  prompt?: string;

  @IsOptional()
  @IsString()
  iss?: string;

  @IsOptional()
  @IsString()
  session_state?: string;

  @IsOptional()
  @IsString()
  hd?: string;
}