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
 * Configuración TypeORM.
 *
 * Modos de conexión:
 * 1. DATABASE_URL completa (Docker / producción)
 * 2. Variables separadas DB_HOST/DB_PORT/etc (dev local)
 *
 * Flags configurables vía .env:
 * - DB_SSL=true        → habilita SSL (default: false, correcto para Docker network)
 * - DB_SYNCHRONIZE=true → TypeORM crea/actualiza tablas automáticamente
 *                         (default: true en dev, false en producción)
 *
 * NOTA sobre DB_SYNCHRONIZE en producción:
 *   Por defecto, TypeORM NO sincroniza schemas en producción para evitar
 *   pérdida de datos accidental. Pero en fase bootstrap (sin migrations
 *   escritas y sin datos críticos), puede ser útil habilitarlo.
 *   Una vez tengas migrations, ponlo en false definitivamente.
 */
function buildDbConfig(config: ConfigService): TypeOrmModuleOptions {
  const isProd = config.get('NODE_ENV') === 'production';
  const url = config.get<string>('DATABASE_URL');
  const useSsl = config.get<string>('DB_SSL') === 'true';

  // synchronize: si está explícitamente seteado, respeta el valor.
  // Sino, default seguro: true en dev, false en prod.
  const syncEnv = config.get<string>('DB_SYNCHRONIZE');
  const synchronize =
    syncEnv === 'true' ? true : syncEnv === 'false' ? false : !isProd;

  const logging: ('error' | 'warn' | 'info' | 'log' | 'query')[] = isProd
    ? ['error']
    : ['error', 'warn'];

  const baseConfig = {
    type: 'postgres' as const,
    entities: [StorageProvider, FileReference, NotificationLog],
    synchronize,
    logging,
    extra: {
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    },
    ssl: useSsl ? { rejectUnauthorized: false } : false,
  };

  if (url && url.trim() !== '') {
    return { ...baseConfig, url };
  }

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
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    LoggingModule,

    ScheduleModule.forRoot(),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: buildDbConfig,
    }),

    RedisModule,

    CredentialsModule,
    GoogleDriveModule,
    NotificationsModule,
    StorageModule,
    JobsModule,
  ],
})
export class AppModule {}
