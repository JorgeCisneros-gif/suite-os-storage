import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import * as path from 'path';
import { GoogleDriveService } from '../providers/google-drive/google-drive.service';
import { LocalStorageService } from './local-storage.service';
import { StorageProvider } from './entities/storage-provider.entity';
import { FileReference, StorageStatus } from './entities/file-reference.entity';

export interface UploadFileDto {
  orgId: string;
  appSource: string;
  entityType: string;
  entityId?: string;
  fileBuffer: Buffer;
  fileName: string;            // puede traer extensión o no
  originalFileName?: string;   // siempre trae la extensión real del archivo subido
  mimeType: string;
  subFolder?: string;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  private readonly defaultRetentionDays = parseInt(process.env.DEFAULT_RETENTION_DAYS || '90');
  private readonly errorRetentionDays   = parseInt(process.env.ERROR_RETENTION_DAYS   || '30');
  private readonly maxRetries           = parseInt(process.env.MAX_UPLOAD_RETRIES     || '3');

  constructor(
    @InjectRepository(StorageProvider) private readonly providerRepo: Repository<StorageProvider>,
    @InjectRepository(FileReference)   private readonly fileRepo: Repository<FileReference>,
    private readonly googleDrive: GoogleDriveService,
    private readonly localStorage: LocalStorageService,
  ) {}

  // ── Upload principal ───────────────────────────────────────

  async upload(dto: UploadFileDto): Promise<FileReference> {
    const provider = await this.providerRepo.findOne({
      where: { orgId: dto.orgId, appSource: dto.appSource, isActive: true },
    });

    if (!provider || provider.type === 'internal') {
      return this.saveAsTemporary(dto, 'no_provider_configured');
    }

    try {
      return await this.uploadToExternal(dto, provider);
    } catch (err) {
      this.logger.warn(`Error subiendo a Drive org=${dto.orgId}: ${err.message}`);
      await this.markProviderError(provider, err.message);
      return this.saveAsTemporary(dto, err.message);
    }
  }

  // ── Obtener URL de descarga ────────────────────────────────

  async getDownloadUrl(fileId: string, orgId: string): Promise<string> {
    const file = await this.fileRepo.findOne({ where: { id: fileId } });
    if (!file) throw new NotFoundException('Archivo no encontrado');

    if (file.status === StorageStatus.EXPIRED || file.status === StorageStatus.DELETED) {
      throw new NotFoundException('Este archivo ya no está disponible');
    }

    if (file.status === StorageStatus.STORED_EXTERNAL) {
      const provider = await this.providerRepo.findOne({
        where: { orgId, appSource: file.appSource },
      });
      return this.googleDrive.getSignedUrl(
        file.externalId,
        provider.credentials as string,
        orgId,
        file.appSource,
      );
    }

    return `/api/v1/internal/files/${fileId}`;
  }

  // ── Servir archivo temporal por su ID ──────────────────────

  async readInternalFile(fileId: string): Promise<{
    buffer: Buffer;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  }> {
    const file = await this.fileRepo.findOne({ where: { id: fileId } });
    if (!file) throw new NotFoundException('Archivo no encontrado');

    if (
      file.status === StorageStatus.EXPIRED ||
      file.status === StorageStatus.DELETED ||
      file.status === StorageStatus.STORED_EXTERNAL
    ) {
      throw new NotFoundException(
        `Archivo no disponible en storage interno (status: ${file.status})`,
      );
    }

    if (!file.internalPath) {
      throw new NotFoundException('Archivo sin path interno registrado');
    }

    const buffer = await this.localStorage.read(file.internalPath);
    return {
      buffer,
      fileName: file.fileName,
      mimeType: file.mimeType,
      sizeBytes: file.fileSizeBytes,
    };
  }

  // ── Reintentar uploads fallidos ────────────────────────────

  async retryPendingUploads(): Promise<{ retried: number; succeeded: number; failed: number }> {
    const pending = await this.fileRepo.find({
      where: { status: StorageStatus.PENDING_RETRY },
      take: 50,
    });

    this.logger.log(`Reintentando ${pending.length} archivos pendientes`);

    let succeeded = 0;
    let failed = 0;

    for (const file of pending) {
      if (file.retryCount >= this.maxRetries) {
        await this.fileRepo.update(file.id, {
          status: StorageStatus.STORED_TEMPORARY,
          expiresAt: this.calcExpiry(this.errorRetentionDays),
          errorReason: `Máximo de reintentos alcanzado: ${file.errorReason}`,
        });
        this.logger.warn(`Archivo ${file.id} marcado como temporal definitivo`);
        continue;
      }

      try {
        await this.retryOne(file);
        succeeded++;
      } catch (err) {
        failed++;
        this.logger.error(`Reintento fallido para ${file.id}: ${err.message}`);
      }
    }

    this.logger.log(
      `Reintentos: ${succeeded} exitosos, ${failed} fallidos, ${pending.length} procesados`,
    );

    return { retried: pending.length, succeeded, failed };
  }

  private async retryOne(file: FileReference): Promise<void> {
    const provider = await this.providerRepo.findOne({
      where: { orgId: file.orgId, appSource: file.appSource, isActive: true },
    });
    if (!provider || provider.type === 'internal') {
      await this.fileRepo.update(file.id, {
        status: StorageStatus.STORED_TEMPORARY,
        expiresAt: this.calcExpiry(this.defaultRetentionDays),
      });
      return;
    }

    if (!file.internalPath || !(await this.localStorage.exists(file.internalPath))) {
      this.logger.warn(
        `Archivo ${file.id} no existe en disco (${file.internalPath}), marcando como expirado`,
      );
      await this.fileRepo.update(file.id, {
        status: StorageStatus.EXPIRED,
        errorReason: 'Archivo no encontrado en storage temporal',
      });
      return;
    }

    const buffer = await this.localStorage.read(file.internalPath);

    this.logger.log(`Reintentando archivo ${file.id} (intento ${file.retryCount + 1})`);

    const result = await this.googleDrive.upload(
      buffer,
      file.fileName,
      file.mimeType,
      provider.credentials as string,
      provider.rootFolderId,
      undefined,
      file.fileName,
      file.orgId,
      file.appSource,
    );

    await this.fileRepo.update(file.id, {
      status: StorageStatus.STORED_EXTERNAL,
      externalId: result.fileId,
      externalUrl: result.webViewLink,
      retryCount: file.retryCount + 1,
      lastRetryAt: new Date(),
      errorReason: null,
      expiresAt: null,
    });

    await this.localStorage.delete(file.internalPath);

    await this.providerRepo.update(provider.id, {
      lastError: null,
      lastErrorAt: null,
      lastSuccessAt: new Date(),
    });

    this.logger.log(`✅ Archivo ${file.id} subido a Drive en reintento: ${result.fileId}`);
  }

  // ── Eliminar archivos expirados ────────────────────────────

  async deleteExpiredFiles(): Promise<{ deleted: number; failed: number }> {
    const expired = await this.fileRepo.find({
      where: {
        status: StorageStatus.STORED_TEMPORARY,
        expiresAt: LessThan(new Date()),
      },
    });

    let deleted = 0;
    let failed = 0;

    for (const file of expired) {
      try {
        if (file.internalPath) {
          await this.localStorage.delete(file.internalPath);
        }
        await this.fileRepo.update(file.id, { status: StorageStatus.EXPIRED });
        deleted++;
      } catch (err) {
        failed++;
        this.logger.error(`Error eliminando expirado ${file.id}: ${err.message}`);
      }
    }

    this.logger.log(`Housekeeping: ${deleted} eliminados, ${failed} fallidos`);
    return { deleted, failed };
  }

  // ── Archivos próximos a expirar ────────────────────────────

  async getExpiringFiles(daysAhead: number): Promise<FileReference[]> {
    const target = new Date();
    target.setDate(target.getDate() + daysAhead);

    const fieldFlag = daysAhead <= 3 ? 'notified3days' : 'notified15days';

    return this.fileRepo.find({
      where: {
        status: StorageStatus.STORED_TEMPORARY,
        expiresAt: LessThan(target),
        [fieldFlag]: false,
      },
    });
  }

  // ── Privados ───────────────────────────────────────────────

  /**
   * Asegura que un fileName tenga extensión.
   *
   * Si `fileName` ya trae extensión (contiene '.') la respeta.
   * Si no, intenta agregársela desde `originalFileName` (que tiene la extensión real
   * del archivo binario subido, ej. '402.jpeg').
   *
   * Esta lógica refleja la que tiene GoogleDriveService.upload, para que tanto
   * el storage temporal como el externo guarden archivos con extensión.
   */
  private ensureExtension(fileName: string, originalFileName?: string): string {
    if (fileName.includes('.')) return fileName;
    if (!originalFileName) return fileName;

    const ext = path.extname(originalFileName); // '.jpeg', '.png', etc.
    if (!ext) return fileName;

    return `${fileName}${ext}`;
  }

  private async uploadToExternal(
    dto: UploadFileDto,
    provider: StorageProvider,
  ): Promise<FileReference> {
    // GoogleDriveService.upload ya maneja la extensión internamente.
    const result = await this.googleDrive.upload(
      dto.fileBuffer,
      dto.fileName,
      dto.mimeType,
      provider.credentials as string,
      provider.rootFolderId,
      dto.subFolder,
      dto.originalFileName,
      dto.orgId,
      dto.appSource,
    );

    await this.providerRepo.update(provider.id, {
      lastError: null,
      lastErrorAt: null,
      lastSuccessAt: new Date(),
    });

    return this.fileRepo.save({
      orgId: dto.orgId,
      appSource: dto.appSource,
      entityType: dto.entityType,
      entityId: dto.entityId,
      providerType: provider.type,
      status: StorageStatus.STORED_EXTERNAL,
      externalId: result.fileId,
      externalUrl: result.webViewLink,
      fileName: result.fileName,
      mimeType: dto.mimeType,
      fileSizeBytes: dto.fileBuffer.length,
      expiresAt: null,
    });
  }

  private async saveAsTemporary(dto: UploadFileDto, reason: string): Promise<FileReference> {
    const isNoProvider = reason === 'no_provider_configured';
    const retentionDays = isNoProvider ? this.defaultRetentionDays : this.errorRetentionDays;
    const status = isNoProvider
      ? StorageStatus.STORED_TEMPORARY
      : StorageStatus.PENDING_RETRY;

    // Asegurar que el archivo en disco lleve extensión
    const fileNameWithExt = this.ensureExtension(dto.fileName, dto.originalFileName);

    let writeResult: { relativePath: string; absolutePath: string; sizeBytes: number };
    try {
      writeResult = await this.localStorage.write({
        orgId: dto.orgId,
        appSource: dto.appSource,
        entityType: dto.entityType,
        fileName: fileNameWithExt,
        buffer: dto.fileBuffer,
      });
    } catch (err) {
      this.logger.error(
        `Error escribiendo archivo temporal a disco: ${err.message}`,
      );
      throw err;
    }

    this.logger.warn(
      `Guardado temporal (${retentionDays}d): ${writeResult.relativePath} — razón: ${reason}`,
    );

    try {
      return await this.fileRepo.save({
        orgId: dto.orgId,
        appSource: dto.appSource,
        entityType: dto.entityType,
        entityId: dto.entityId,
        providerType: 'internal',
        status,
        internalPath: writeResult.relativePath,
        expiresAt: this.calcExpiry(retentionDays),
        fileName: fileNameWithExt,  // ← guardar con extensión también en DB
        mimeType: dto.mimeType,
        fileSizeBytes: writeResult.sizeBytes,
        errorReason: isNoProvider ? null : reason,
      });
    } catch (dbErr) {
      await this.localStorage.delete(writeResult.relativePath);
      throw dbErr;
    }
  }

  private async markProviderError(provider: StorageProvider, error: string): Promise<void> {
    await this.providerRepo.update(provider.id, {
      lastError: error,
      lastErrorAt: new Date(),
    });
  }

  private calcExpiry(days: number): Date {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d;
  }
}
