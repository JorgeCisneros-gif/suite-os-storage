import {
  Controller, Post, Get, Delete, Param, Query,
  Headers, UnauthorizedException, Req, Res,
  Logger, BadRequestException, PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiSecurity, ApiBody, ApiConsumes,
  ApiResponse,
} from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { validateOrReject } from 'class-validator';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { StorageService } from '../storage/storage.service';
import { LocalStorageService } from '../storage/local-storage.service';
import { GoogleDriveService } from '../providers/google-drive/google-drive.service';
import { StorageProvider } from '../storage/entities/storage-provider.entity';
import { CredentialsService } from '../credentials/credentials.service';
import { OAuthCacheService } from '../redis/oauth-cache.service';

import { AppSourceQueryDto } from './dto/app-source-query.dto';
import { GoogleConnectQueryDto } from './dto/google-connect-query.dto';
import { GoogleCallbackQueryDto } from './dto/google-callback-query.dto';
import { GetDownloadUrlQueryDto } from './dto/get-download-url-query.dto';
import { UploadFileFieldsDto } from './dto/upload-file-fields.dto';
import { OrgIdParamDto, FileIdParamDto } from './dto/uuid-param.dto';

const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
  'application/pdf',
];

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

function validateApiKey(key: string) {
  if (!key || key !== process.env.INTERNAL_API_KEY) {
    throw new UnauthorizedException('API key inválida o ausente');
  }
}

@ApiTags('Storage Gateway')
@ApiSecurity('internal-api-key')
@Controller()
export class StorageController {
  private readonly logger = new Logger(StorageController.name);

  constructor(
    private readonly storageService: StorageService,
    private readonly localStorage: LocalStorageService,
    private readonly googleDrive: GoogleDriveService,
    private readonly credentialsService: CredentialsService,
    private readonly oauthCache: OAuthCacheService,
    @InjectRepository(StorageProvider)
    private readonly providerRepo: Repository<StorageProvider>,
  ) {}

  // ── Upload ─────────────────────────────────────────────────

  @Post('files/upload')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Sube un archivo al storage del usuario o temporal' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['orgId', 'appSource', 'entityType', 'file'],
      properties: {
        orgId:          { type: 'string', format: 'uuid' },
        appSource:      { type: 'string', enum: ['departmentos', 'inventoryos'] },
        entityType:     { type: 'string', example: 'meter_reading' },
        entityId:       { type: 'string', format: 'uuid' },
        subFolder:      { type: 'string', example: 'Lecturas' },
        customFileName: { type: 'string', example: 'lectura_dept101_jun2026' },
        file:           { type: 'string', format: 'binary' },
      },
    },
  })
  async upload(@Req() req: any, @Headers('x-api-key') apiKey: string) {
    validateApiKey(apiKey);

    const fields: Record<string, string> = {};
    let fileBuffer: Buffer | null = null;
    let originalFileName: string | null = null;
    let mimeType: string | null = null;

    for await (const part of req.parts()) {
      if (part.type === 'file') {
        const buf = await part.toBuffer();
        if (buf.length > MAX_FILE_SIZE_BYTES) {
          throw new PayloadTooLargeException(
            `El archivo excede el tamaño máximo de ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB`,
          );
        }
        fileBuffer = buf;
        originalFileName = part.filename;
        mimeType = part.mimetype;
      } else {
        fields[part.fieldname] = part.value as string;
      }
    }

    if (!fileBuffer || fileBuffer.length === 0) {
      throw new BadRequestException('No se recibió ningún archivo (campo "file" requerido)');
    }

    if (!mimeType || !ALLOWED_MIME_TYPES.includes(mimeType.toLowerCase())) {
      throw new UnsupportedMediaTypeException(
        `Tipo de archivo no soportado: ${mimeType}. Permitidos: ${ALLOWED_MIME_TYPES.join(', ')}`,
      );
    }

    const dto = plainToInstance(UploadFileFieldsDto, fields);
    try {
      await validateOrReject(dto, { whitelist: true, forbidNonWhitelisted: true });
    } catch (errors: any) {
      const messages = Array.isArray(errors)
        ? errors.flatMap((e) => Object.values(e.constraints || {}))
        : ['Datos del formulario inválidos'];
      throw new BadRequestException(messages);
    }

    const fileName = dto.customFileName || originalFileName!;

    this.logger.log(
      `📥 Upload: orgId=${dto.orgId} app=${dto.appSource} entityType=${dto.entityType}`,
    );

    const file = await this.storageService.upload({
      orgId: dto.orgId,
      appSource: dto.appSource,
      entityType: dto.entityType,
      entityId: dto.entityId,
      fileBuffer,
      fileName,
      originalFileName,
      mimeType,
      subFolder: dto.subFolder,
    });

    return {
      success: true,
      fileId: file.id,
      fileName: file.fileName,
      status: file.status,
      expiresAt: file.expiresAt,
      storageType: file.providerType,
      externalUrl: file.externalUrl,
    };
  }

  // ── URL de descarga ────────────────────────────────────────

  @Get('files/:id/url')
  @ApiOperation({ summary: 'Obtiene URL de descarga de un archivo' })
  async getDownloadUrl(
    @Param() params: FileIdParamDto,
    @Query() query: GetDownloadUrlQueryDto,
    @Headers('x-api-key') apiKey: string,
  ) {
    validateApiKey(apiKey);
    const url = await this.storageService.getDownloadUrl(params.id, query.orgId);
    return { url };
  }

  // ── Servir archivo TEMPORAL (internal) ────────────────────
  //
  // Este endpoint sirve los archivos que están en el storage temporal
  // del gateway. Solo accesible con INTERNAL_API_KEY → lo consume el
  // backend del cliente (no el browser del usuario final).

  @Get('internal/files/:id')
  @ApiOperation({
    summary: 'Descarga un archivo temporal del storage interno',
    description:
      'Devuelve el binario del archivo. Solo para uso interno entre ' +
      'backends. El backend cliente debe luego servirlo a su frontend.',
  })
  @ApiResponse({ status: 200, description: 'Archivo binario' })
  @ApiResponse({ status: 401, description: 'API key inválida' })
  @ApiResponse({ status: 404, description: 'Archivo no encontrado o ya expirado' })
  async downloadInternal(
    @Param() params: FileIdParamDto,
    @Headers('x-api-key') apiKey: string,
    @Res() res: any,
  ) {
    validateApiKey(apiKey);

    const file = await this.storageService.readInternalFile(params.id);

    // Headers para que el cliente sepa qué está recibiendo
    res
      .header('Content-Type', file.mimeType)
      .header('Content-Length', String(file.sizeBytes))
      .header(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(file.fileName)}"`,
      )
      .header('Cache-Control', 'private, max-age=300') // 5 min de cache
      .send(file.buffer);
  }

  // ── Stats del storage temporal ─────────────────────────────

  @Get('internal/stats')
  @ApiOperation({
    summary: 'Estadísticas del storage temporal',
    description: 'Devuelve cantidad de archivos y bytes totales. Útil para monitoreo.',
  })
  async getInternalStats(@Headers('x-api-key') apiKey: string) {
    validateApiKey(apiKey);
    const stats = await this.localStorage.getStats();
    return {
      ...stats,
      humanReadable: {
        files: stats.files.toLocaleString(),
        size: this.humanizeBytes(stats.totalBytes),
      },
    };
  }

  private humanizeBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  }

  // ── Estado del provider ────────────────────────────────────

  @Get('providers/:orgId')
  @ApiOperation({ summary: 'Estado del provider configurado para una org' })
  async getProviderStatus(
    @Param() params: OrgIdParamDto,
    @Query() query: AppSourceQueryDto,
    @Headers('x-api-key') apiKey: string,
  ) {
    validateApiKey(apiKey);

    const provider = await this.providerRepo.findOne({
      where: { orgId: params.orgId, appSource: query.appSource },
    });

    if (!provider) {
      return {
        configured: false,
        type: 'internal',
        message: 'Sin storage externo configurado',
      };
    }

    return {
      configured: true,
      type: provider.type,
      connectedEmail: provider.connectedEmail,
      rootFolderName: provider.rootFolderName,
      isActive: provider.isActive,
      lastError: provider.lastError,
      lastErrorAt: provider.lastErrorAt,
      lastSuccessAt: provider.lastSuccessAt,
    };
  }

  // ── OAuth Google Drive ─────────────────────────────────────

  @Get('auth/google/connect')
  @ApiOperation({ summary: 'Inicia el flujo OAuth2 con Google Drive' })
  async googleConnect(@Query() query: GoogleConnectQueryDto, @Res() res: any) {
    const state = Buffer
      .from(JSON.stringify({ orgId: query.orgId, appSource: query.appSource }))
      .toString('base64');
    const authUrl = this.googleDrive.getAuthUrl(state);
    return res.redirect(302, authUrl);
  }

  @Get('auth/google/callback')
  @ApiOperation({ summary: 'Callback OAuth2 de Google — no llamar directamente' })
  async googleCallback(@Query() query: GoogleCallbackQueryDto, @Res() res: any) {
    let orgId: string;
    let appSource: string;

    try {
      const decoded = JSON.parse(Buffer.from(query.state, 'base64').toString('utf-8'));
      orgId = decoded.orgId;
      appSource = decoded.appSource;
      if (!orgId || !appSource) throw new Error('State no contiene orgId o appSource');
    } catch (err: any) {
      this.logger.error(`State inválido en callback: ${err.message}`);
      return res.status(400).send(`State inválido: ${err.message}`);
    }

    try {
      const { tokens, email } = await this.googleDrive.exchangeCode(query.code);
      const encryptedCredentials = this.credentialsService.encrypt(tokens);

      const appName =
        appSource === 'departmentos' ? 'DepartmentOS' :
        appSource === 'inventoryos'  ? 'InventoryOS'  : 'Suite-OS';

      const rootFolderId = await this.googleDrive.createRootFolder(
        appName, encryptedCredentials, orgId, appSource,
      );

      let provider = await this.providerRepo.findOne({ where: { orgId, appSource } });

      if (provider) {
        await this.providerRepo.update(provider.id, {
          credentials: encryptedCredentials as any,
          connectedEmail: email,
          rootFolderId,
          rootFolderName: appName,
          isActive: true,
          lastError: null,
          lastErrorAt: null,
          lastSuccessAt: new Date(),
        });
      } else {
        provider = await this.providerRepo.save({
          orgId, appSource, type: 'google_drive',
          credentials: encryptedCredentials as any,
          connectedEmail: email,
          rootFolderId, rootFolderName: appName,
          isActive: true,
          lastSuccessAt: new Date(),
        });
      }

      await this.oauthCache.invalidate(orgId, appSource);

      this.logger.log(`Drive conectado: org=${orgId} app=${appSource} email=${email}`);

      const redirectBase = appSource === 'departmentos'
        ? process.env.DEPARMENTOS_URL || 'http://localhost:5173'
        : process.env.INVENTORYOS_URL || 'http://localhost:5174';

      return res.redirect(302, `${redirectBase}/settings/storage?connected=true`);
    } catch (err: any) {
      this.logger.error(`Error en callback OAuth: ${err.message}`, err.stack);
      return res.status(500).send(`Error procesando callback: ${err.message}`);
    }
  }

  // ── Desconectar Drive ──────────────────────────────────────

  @Delete('auth/:orgId')
  @ApiOperation({ summary: 'Revoca acceso al Drive del usuario' })
  async disconnect(
    @Param() params: OrgIdParamDto,
    @Query() query: AppSourceQueryDto,
    @Headers('x-api-key') apiKey: string,
  ) {
    validateApiKey(apiKey);
    await this.providerRepo.update(
      { orgId: params.orgId, appSource: query.appSource },
      { isActive: false },
    );
    await this.oauthCache.invalidate(params.orgId, query.appSource);
    this.logger.log(`Drive desconectado: org=${params.orgId} app=${query.appSource}`);
    return {
      success: true,
      message: 'Drive desconectado. Los archivos existentes no se eliminan.',
    };
  }

  // ── Health ─────────────────────────────────────────────────

  @Get('health')
  @ApiOperation({ summary: 'Health check del servicio' })
  health() {
    return {
      status: 'ok',
      service: 'suite-os-storage-gateway',
      ts: new Date().toISOString(),
    };
  }
}
