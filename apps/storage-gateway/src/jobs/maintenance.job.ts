import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { StorageService } from '../storage/storage.service';
import { GoogleDriveService } from '../providers/google-drive/google-drive.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageProvider } from '../storage/entities/storage-provider.entity';
import { FileReference } from '../storage/entities/file-reference.entity';

@Injectable()
export class MaintenanceJob {
  private readonly logger = new Logger(MaintenanceJob.name);

  constructor(
    private readonly storageService: StorageService,
    private readonly googleDrive: GoogleDriveService,
    private readonly notifications: NotificationsService,
    @InjectRepository(StorageProvider) private readonly providerRepo: Repository<StorageProvider>,
    @InjectRepository(FileReference)   private readonly fileRepo: Repository<FileReference>,
  ) {}

  // ── Cada día a las 2:00 AM ─────────────────────────────────
  @Cron('0 2 * * *')
  async dailyMaintenance() {
    this.logger.log('=== Inicio mantenimiento diario de storage ===');

    await this.retryFailedUploads();
    await this.notifyExpiringFiles();
    await this.deleteExpiredFiles();
    await this.checkDriveHealth();

    this.logger.log('=== Mantenimiento diario completado ===');
  }

  // ── Cada hora: reintentar subidas fallidas ─────────────────
  @Cron(CronExpression.EVERY_HOUR)
  async retryFailedUploads() {
    this.logger.debug('Reintentando subidas fallidas...');
    // El service ahora devuelve detalles del resultado.
    const result = await this.storageService.retryPendingUploads();
    if (result.retried > 0) {
      this.logger.log(
        `🔄 Reintentos: ${result.succeeded}/${result.retried} exitosos, ${result.failed} fallidos`,
      );
    }
  }

  // ── Notificar archivos próximos a expirar ──────────────────
  private async notifyExpiringFiles() {
    // 15 días
    const expiring15 = await this.storageService.getExpiringFiles(15);
    for (const file of expiring15) {
      await this.notifications.notifyFileExpiringSoon(
        file.orgId, file.appSource, file.id, file.expiresAt, false,
      );
      await this.fileRepo.update(file.id, { notified15days: true });
    }

    // 3 días (urgente)
    const expiring3 = await this.storageService.getExpiringFiles(3);
    for (const file of expiring3) {
      await this.notifications.notifyFileExpiringSoon(
        file.orgId, file.appSource, file.id, file.expiresAt, true,
      );
      await this.fileRepo.update(file.id, { notified3days: true });
    }

    this.logger.log(
      `Notificaciones expiración: ${expiring15.length} a 15d, ${expiring3.length} a 3d`,
    );
  }

  // ── Eliminar archivos expirados ────────────────────────────
  private async deleteExpiredFiles() {
    // El service ahora devuelve { deleted, failed } y maneja
    // automáticamente la eliminación tanto del registro en DB
    // como del archivo en disco (LocalStorageService).
    const result = await this.storageService.deleteExpiredFiles();
    this.logger.log(
      `Archivos expirados: ${result.deleted} eliminados, ${result.failed} fallidos`,
    );
  }

  // ── Verificar salud de Drives conectados ───────────────────
  @Cron('0 8 * * *')
  private async checkDriveHealth() {
    const providers = await this.providerRepo.find({
      where: { type: 'google_drive' as any, isActive: true },
    });

    this.logger.log(`Verificando salud de ${providers.length} providers Google Drive`);

    for (const provider of providers) {
      // Pasamos orgId/appSource para que aproveche el cache OAuth de Redis.
      const health = await this.googleDrive.checkHealth(
        provider.credentials as string,
        provider.orgId,
        provider.appSource,
      );

      if (!health.ok) {
        await this.providerRepo.update(provider.id, {
          lastError: health.error,
          lastErrorAt: new Date(),
        });

        if (health.error === 'token_revoked') {
          await this.notifications.notifyDriveTokenRevoked(provider.orgId, provider.appSource);
        } else if (health.error === 'insufficient_space') {
          await this.notifications.notifyDriveNoSpace(
            provider.orgId, provider.appSource, health.freeSpaceBytes,
          );
        } else {
          await this.notifications.notifyDriveError(
            provider.orgId, provider.appSource, health.error,
          );
        }

        this.logger.warn(`Drive con problemas org=${provider.orgId}: ${health.error}`);
      }
    }
  }
}
