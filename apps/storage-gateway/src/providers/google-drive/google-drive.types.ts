/**
 * Tipos compartidos del provider Google Drive.
 * Se mantiene en archivo aparte para evitar dependencias circulares
 * cuando otros módulos (ej. OAuthCacheService) necesitan estos tipos.
 */

export interface GoogleTokens {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
  token_type: string;
}

export interface UploadResult {
  fileId: string;
  webViewLink: string;
  fileName: string;
}
