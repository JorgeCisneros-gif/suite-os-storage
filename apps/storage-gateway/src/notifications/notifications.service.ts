import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationLog, NotificationEvent } from './notification-log.entity';
import axios from 'axios';

interface NotifyPayload {
  orgId: string;
  appSource: string;
  event: NotificationEvent;
  data?: Record<string, any>;
}

/** Mapa de webhooks registrados por app.
 *  En producción esto vendría de una tabla o de env vars por app. */
const WEBHOOK_URLS: Record<string, string> = {
  departmentos: process.env.DEPARMENTOS_WEBHOOK_URL || '',
  inventoryos:  process.env.INVENTORYOS_WEBHOOK_URL  || '',
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(NotificationLog)
    private readonly logRepo: Repository<NotificationLog>,
  ) {}

  async notify(payload: NotifyPayload): Promise<void> {
    const webhookUrl = WEBHOOK_URLS[payload.appSource];

    const log = this.logRepo.create({
      orgId: payload.orgId,
      appSource: payload.appSource,
      event: payload.event,
      payload: payload.data || null,
      webhookUrl: webhookUrl || null,
    });

    if (!webhookUrl) {
      this.logger.warn(`No hay webhook configurado para app=${payload.appSource}, evento=${payload.event}`);
      await this.logRepo.save(log);
      return;
    }

    try {
      const response = await axios.post(
        webhookUrl,
        {
          event: payload.event,
          orgId: payload.orgId,
          data: payload.data,
          ts: new Date().toISOString(),
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-storage-secret': process.env.INTERNAL_API_KEY,
          },
          timeout: 5000,
        },
      );

      log.webhookStatus = response.status;
      this.logger.log(`Notificación enviada: ${payload.event} → ${payload.appSource} (${response.status})`);
    } catch (err) {
      log.webhookStatus = err?.response?.status || 0;
      this.logger.error(`Error enviando notificación ${payload.event}: ${err.message}`);
    }

    await this.logRepo.save(log);
  }

  // ── Helpers de eventos específicos ────────────────────────

  async notifyDriveError(orgId: string, appSource: string, error: string) {
    await this.notify({ orgId, appSource, event: 'drive_error', data: { error } });
  }

  async notifyDriveNoSpace(orgId: string, appSource: string, freeBytes: number) {
    await this.notify({ orgId, appSource, event: 'drive_no_space', data: { freeBytes } });
  }

  async notifyDriveTokenRevoked(orgId: string, appSource: string) {
    await this.notify({ orgId, appSource, event: 'drive_token_revoked' });
  }

  async notifyDriveConnected(orgId: string, appSource: string, email: string) {
    await this.notify({ orgId, appSource, event: 'drive_connected', data: { email } });
  }

  async notifyFileExpiringSoon(orgId: string, appSource: string, fileId: string, expiresAt: Date, urgent = false) {
    await this.notify({
      orgId, appSource,
      event: urgent ? 'file_expiring_urgent' : 'file_expiring_soon',
      data: { fileId, expiresAt },
    });
  }

  async notifyFileExpired(orgId: string, appSource: string, fileId: string, fileName: string) {
    await this.notify({ orgId, appSource, event: 'file_expired', data: { fileId, fileName } });
  }

  async notifyRetryFailed(orgId: string, appSource: string, fileId: string) {
    await this.notify({ orgId, appSource, event: 'retry_failed_permanent', data: { fileId } });
  }
}
