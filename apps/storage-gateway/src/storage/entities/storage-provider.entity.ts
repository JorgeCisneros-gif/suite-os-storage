import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm';

export type StorageProviderType = 'google_drive' | 'onedrive' | 's3' | 'sftp' | 'internal';

@Entity('storage_providers')
@Index(['orgId', 'appSource'], { unique: true })
export class StorageProvider {

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'org_id', type: 'uuid' })
  @Index()
  orgId: string;

  @Column({ name: 'app_source', length: 50 })
  appSource: string;

  @Column({ type: 'varchar', length: 30, default: 'internal' })
  type: StorageProviderType;

  /**
   * Credenciales cifradas con AES-256.
   * Se guarda como string (ciphertext) aunque la columna sea JSONB.
   * El CredentialsService se encarga de cifrar/descifrar.
   */
  @Column({ type: 'jsonb' })
  credentials: string | Record<string, any>;

  @Column({ name: 'root_folder_id', length: 500, nullable: true })
  rootFolderId: string | null;

  @Column({ name: 'root_folder_name', length: 255, nullable: true })
  rootFolderName: string | null;

  @Column({ name: 'connected_email', length: 255, nullable: true })
  connectedEmail: string | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @Column({ name: 'last_error_at', type: 'timestamptz', nullable: true })
  lastErrorAt: Date | null;

  @Column({ name: 'last_success_at', type: 'timestamptz', nullable: true })
  lastSuccessAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
