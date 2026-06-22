import { Injectable, Logger } from '@nestjs/common';
import { google, drive_v3 } from 'googleapis';
import { CredentialsService } from '../../credentials/credentials.service';
import { OAuthCacheService } from '../../redis/oauth-cache.service';
import { GoogleTokens, UploadResult } from './google-drive.types';

// Re-exportamos los tipos para mantener compatibilidad con código que ya los importa de aquí
export { GoogleTokens, UploadResult } from './google-drive.types';

@Injectable()
export class GoogleDriveService {
  private readonly logger = new Logger(GoogleDriveService.name);

  private readonly clientId     = process.env.GOOGLE_CLIENT_ID;
  private readonly clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  private readonly callbackUrl  = process.env.GOOGLE_CALLBACK_URL;

  constructor(
    private readonly credentialsService: CredentialsService,
    private readonly oauthCache: OAuthCacheService,
  ) {}

  // ── OAuth2 ─────────────────────────────────────────────────

  getAuthUrl(state: string): string {
    const oauth2Client = this.createOAuth2Client();
    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',          // fuerza refresh_token siempre
      scope: [
        'https://www.googleapis.com/auth/drive.file',  // solo archivos de la app
        'https://www.googleapis.com/auth/userinfo.email',
      ],
      state,
    });
  }

  async exchangeCode(code: string): Promise<{ tokens: GoogleTokens; email: string }> {
    const oauth2Client = this.createOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Obtener email del usuario que autorizó
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data } = await oauth2.userinfo.get();

    return {
      tokens: tokens as GoogleTokens,
      email: data.email,
    };
  }

  // ── Operaciones de archivos ────────────────────────────────

  async upload(
    fileBuffer: Buffer,
    fileName: string,
    mimeType: string,
    encryptedCredentials: string,
    rootFolderId: string,
    subFolder?: string,
    originalFileName?: string,
    orgId?: string,
    appSource?: string,
  ): Promise<UploadResult> {
    const drive = await this.getDriveClient(encryptedCredentials, orgId, appSource);

    // Si el nombre que viene no tiene extensión y tenemos el original,
    // preservamos la extensión del archivo subido
    let finalName = fileName;
    if (originalFileName && !finalName.includes('.')) {
      const ext = originalFileName.split('.').pop();
      if (ext) finalName = `${fileName}.${ext}`;
    }

    // Resolver o crear subcarpeta
    let parentId = rootFolderId;
    if (subFolder) {
      parentId = await this.ensureFolder(drive, subFolder, rootFolderId);
    }

    const { Readable } = await import('stream');
    const stream = new Readable();
    stream.push(fileBuffer);
    stream.push(null);

    const response = await drive.files.create({
      requestBody: {
        name: finalName,
        parents: [parentId],
      },
      media: { mimeType, body: stream },
      fields: 'id, webViewLink',
    });

    this.logger.log(`Archivo subido a Drive: ${response.data.id} (${finalName})`);

    return {
      fileId: response.data.id,
      webViewLink: response.data.webViewLink,
      fileName: finalName,
    };
  }

  async getSignedUrl(
    fileId: string,
    encryptedCredentials: string,
    orgId?: string,
    appSource?: string,
  ): Promise<string> {
    const drive = await this.getDriveClient(encryptedCredentials, orgId, appSource);
    const { data } = await drive.files.get({ fileId, fields: 'webContentLink, webViewLink' });
    return data.webContentLink || data.webViewLink;
  }

  async delete(
    fileId: string,
    encryptedCredentials: string,
    orgId?: string,
    appSource?: string,
  ): Promise<void> {
    const drive = await this.getDriveClient(encryptedCredentials, orgId, appSource);
    await drive.files.delete({ fileId });
    this.logger.log(`Archivo eliminado de Drive: ${fileId}`);
  }

  async checkHealth(
    encryptedCredentials: string,
    orgId?: string,
    appSource?: string,
  ): Promise<{ ok: boolean; error?: string; freeSpaceBytes?: number }> {
    try {
      const drive = await this.getDriveClient(encryptedCredentials, orgId, appSource);
      const { data } = await drive.about.get({ fields: 'storageQuota' });
      const quota = data.storageQuota;
      const used = parseInt(quota.usage || '0');
      const total = parseInt(quota.limit || '0');
      const free = total > 0 ? total - used : -1; // -1 = ilimitado (Google One)

      if (free > 0 && free < 100 * 1024 * 1024) { // menos de 100MB
        return { ok: false, error: 'insufficient_space', freeSpaceBytes: free };
      }
      return { ok: true, freeSpaceBytes: free };
    } catch (err) {
      const msg = err?.message || 'unknown_error';
      if (msg.includes('invalid_grant') || msg.includes('Token has been expired')) {
        return { ok: false, error: 'token_revoked' };
      }
      return { ok: false, error: msg };
    }
  }

  // ── Helpers ────────────────────────────────────────────────

  async createRootFolder(
    folderName: string,
    encryptedCredentials: string,
    orgId?: string,
    appSource?: string,
  ): Promise<string> {
    const drive = await this.getDriveClient(encryptedCredentials, orgId, appSource);
    return this.ensureFolder(drive, folderName, 'root');
  }

  private async ensureFolder(drive: drive_v3.Drive, name: string, parentId: string): Promise<string> {
    // Buscar si ya existe
    const existing = await drive.files.list({
      q: `name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`,
      fields: 'files(id)',
    });

    if (existing.data.files?.length > 0) {
      return existing.data.files[0].id;
    }

    // Crear si no existe
    const { data } = await drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      },
      fields: 'id',
    });
    return data.id;
  }

  private createOAuth2Client() {
    return new google.auth.OAuth2(this.clientId, this.clientSecret, this.callbackUrl);
  }

  /**
   * Obtiene el cliente Drive autenticado.
   * Si tenemos orgId+appSource, intenta usar cache de Redis para los tokens
   * (evita el descifrado AES en cada petición).
   */
  private async getDriveClient(
    encryptedCredentials: string,
    orgId?: string,
    appSource?: string,
  ): Promise<drive_v3.Drive> {
    let tokens: GoogleTokens | null = null;

    // Intentar desde cache si tenemos las claves
    if (orgId && appSource) {
      tokens = await this.oauthCache.get(orgId, appSource);
    }

    // Si no hubo cache hit, descifrar de DB
    if (!tokens) {
      tokens = this.credentialsService.decrypt<GoogleTokens>(encryptedCredentials);

      // Guardar en cache para próximas peticiones
      if (orgId && appSource) {
        await this.oauthCache.set(orgId, appSource, tokens);
      }
    }

    const oauth2Client = this.createOAuth2Client();
    oauth2Client.setCredentials(tokens);

    // Cuando Google refresca el token automáticamente, actualizamos el cache también
    oauth2Client.on('tokens', async (newTokens) => {
      this.logger.debug('Token de Google refrescado automáticamente');

      if (orgId && appSource) {
        // Merge: preservamos el refresh_token original si Google no lo devolvió
        const updatedTokens: GoogleTokens = {
          ...tokens,
          ...newTokens,
          refresh_token: newTokens.refresh_token || tokens.refresh_token,
        } as GoogleTokens;
        await this.oauthCache.set(orgId, appSource, updatedTokens);
      }
    });

    return google.drive({ version: 'v3', auth: oauth2Client });
  }
}
