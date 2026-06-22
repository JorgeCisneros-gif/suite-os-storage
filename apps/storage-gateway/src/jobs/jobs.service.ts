import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { StorageService } from '../storage/storage.service';

/**
 * Jobs cron del gateway:
 * - Cada 5 min: reintentar uploads pendientes
 * - Cada hora: eliminar archivos temporales expirados (DB + disco)
 *
 * Estos jobs ya estaban antes, pero ahora REALMENTE leen/borran del disco
 * gracias al LocalStorageService integrado en StorageService.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(private readonly storageService: StorageService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async retryPending(): Promise<void> {
    try {
      const result = await this.storageService.retryPendingUploads();
      if (result.retried > 0) {
        this.logger.log(
          `🔄 Reintentos: ${result.succeeded}/${result.retried} exitosos, ${result.failed} fallidos`,
        );
      }
    } catch (err: any) {
      this.logger.error(`Error en cron de reintentos: ${err.message}`);
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async cleanExpired(): Promise<void> {
    try {
      const result = await this.storageService.deleteExpiredFiles();
      if (result.deleted > 0 || result.failed > 0) {
        this.logger.log(
          `🗑️  Housekeeping: ${result.deleted} eliminados, ${result.failed} fallidos`,
        );
      }
    } catch (err: any) {
      this.logger.error(`Error en cron de housekeeping: ${err.message}`);
    }
  }
}
