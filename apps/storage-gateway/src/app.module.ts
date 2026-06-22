import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';

import { StorageProvider } from './storage/entities/storage-provider.entity';
import { FileReference } from './storage/entities/file-reference.entity';
import { NotificationLog } from './notifications/notification-log.entity';

import { CredentialsModule } from './credentials/credentials.module';
import { GoogleDriveModule } from './providers/google-drive/google-drive.module';
import { StorageModule } from './storage/storage.module';
import { NotificationsModule } from './notifications/notifications.module';
import { JobsModule } from './jobs/jobs.module';
import { RedisModule } from './redis/redis.module';
import { LoggingModule } from './common/logging.module';

/**
 * Configuración TypeORM con dos modos:
 *
 * 1. DATABASE_URL completa (modo Docker / producción):
 *    DATABASE_URL=postgresql://user:pass@host:5432/db
 *
 * 2. Variables separadas (modo dev local):
 *    DB_HOST=localhost
 *    DB_PORT=5432
 *    DB_USER=storage_user
 *    POSTGRES_PASSWORD=...
 *    DB_NAME=suite_storage
 *
 * Si DATABASE_URL está presente, tiene prioridad. Sino, se usan las variables separadas.
 */
function buildDbConfig(config: ConfigService): TypeOrmModuleOptions {
  const isProd = config.get('NODE_ENV') === 'production';
  const url = config.get<string>('DATABASE_URL');

  // Logging mutable (TypeORM espera LogLevel[], no readonly array)
  const logging: ('error' | 'warn' | 'info' | 'log' | 'query')[] = isProd
    ? ['error']
    : ['error', 'warn'];

  const baseConfig = {
    type: 'postgres' as const,
    entities: [StorageProvider, FileReference, NotificationLog],
    synchronize: !isProd,
    logging,
    extra: {
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    },
    ssl: isProd ? { rejectUnauthorized: false } : false,
  };

  if (url && url.trim() !== '') {
    return { ...baseConfig, url };
  }

  // Modo dev local: variables separadas
  return {
    ...baseConfig,
    host: config.get<string>('DB_HOST') || 'localhost',
    port: parseInt(config.get<string>('DB_PORT') || '5432', 10),
    username: config.get<string>('DB_USER') || 'storage_user',
    password: config.get<string>('POSTGRES_PASSWORD') || '',
    database: config.get<string>('DB_NAME') || 'suite_storage',
  };
}

@Module({
  imports: [
    // ── Config global (.env) ──────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // ── Logging estructurado (debe ir antes que otros módulos) ─
    LoggingModule,

    // ── Cron jobs ─────────────────────────────────────────────
    ScheduleModule.forRoot(),

    // ── Base de datos ─────────────────────────────────────────
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: buildDbConfig,
    }),

    // ── Redis ─────────────────────────────────────────────────
    RedisModule,

    // ── Módulos de la app ─────────────────────────────────────
    CredentialsModule,
    GoogleDriveModule,
    NotificationsModule,
    StorageModule,
    JobsModule,
  ],
})
export class AppModule {}
