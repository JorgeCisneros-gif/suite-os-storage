import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm';
import { StorageProviderType } from './storage-provider.entity';

export enum StorageStatus {
  STORED_EXTERNAL  = 'stored_external',   // en Drive del usuario ✅
  STORED_TEMPORARY = 'stored_temporary',  // en storage propio, con expiración ⏳
  PENDING_RETRY    = 'pending_retry',     // falló, se reintentará 🔄
  EXPIRED          = 'expired',           // eliminado por retención 🗑️
  DELETED          = 'deleted',           // eliminado por el usuario
}

@Entity('file_references')
export class FileReference {

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'org_id', type: 'uuid' })
  @Index()
  orgId: string;

  @Column({ name: 'app_source', length: 50 })
  appSource: string;

  @Column({ name: 'entity_type', length: 100, nullable: true })
  entityType: string | null;

  @Column({ name: 'entity_id', type: 'uuid', nullable: true })
  @Index()
  entityId: string | null;

  @Column({ name: 'provider_type', type: 'varchar', length: 30, default: 'internal' })
providerType: StorageProviderType;

  @Column({
    type: 'enum',
    enum: StorageStatus,
    default: StorageStatus.STORED_TEMPORARY,
  })
  @Index()
  status: StorageStatus;

  // ── Cuando está en Drive externo ───────────────────────────

  @Column({ name: 'external_id', length: 500, nullable: true })
  externalId: string | null;

  @Column({ name: 'external_url', type: 'text', nullable: true })
  externalUrl: string | null;

  // ── Cuando está en storage interno (fallback) ──────────────

  @Column({ name: 'internal_path', type: 'text', nullable: true })
  internalPath: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  @Index()
  expiresAt: Date | null;

  // ── Metadata del archivo ───────────────────────────────────

  @Column({ name: 'file_name', length: 500 })
  fileName: string;

  @Column({ name: 'mime_type', length: 100, nullable: true })
  mimeType: string | null;

  @Column({ name: 'file_size_bytes', type: 'bigint', nullable: true })
  fileSizeBytes: number | null;

  // ── Control de reintentos ──────────────────────────────────

  @Column({ name: 'retry_count', type: 'smallint', default: 0 })
  retryCount: number;

  @Column({ name: 'last_retry_at', type: 'timestamptz', nullable: true })
  lastRetryAt: Date | null;

  @Column({ name: 'error_reason', type: 'text', nullable: true })
  errorReason: string | null;

  // ── Control de notificaciones (evitar duplicados) ──────────

  @Column({ name: 'notified_15days', default: false })
  notified15days: boolean;

  @Column({ name: 'notified_3days', default: false })
  notified3days: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
