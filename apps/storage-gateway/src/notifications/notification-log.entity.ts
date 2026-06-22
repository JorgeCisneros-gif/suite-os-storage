import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, Index,
} from 'typeorm';

export type NotificationEvent =
  | 'drive_connected'
  | 'drive_disconnected'
  | 'drive_error'
  | 'drive_no_space'
  | 'drive_token_revoked'
  | 'file_expiring_soon'
  | 'file_expiring_urgent'
  | 'file_expired'
  | 'retry_failed_permanent';

@Entity('notification_logs')
export class NotificationLog {

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'org_id', type: 'uuid' })
  @Index()
  orgId: string;

  @Column({ name: 'app_source', length: 50 })
  appSource: string;

  @Column({ type: 'varchar', length: 60 })
  event: NotificationEvent;

  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, any> | null;

  /** URL del webhook de la app destino que recibió la notificación */
  @Column({ name: 'webhook_url', type: 'text', nullable: true })
  webhookUrl: string | null;

  @Column({ name: 'webhook_status', type: 'smallint', nullable: true })
  webhookStatus: number | null;

  @CreateDateColumn({ name: 'sent_at', type: 'timestamptz' })
  sentAt: Date;
}
