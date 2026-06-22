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
 * Soporta dos modos de conexión:
 * 1. DATABASE_URL completa (Docker / producción)
 * 2. Variables separadas DB_HOST/DB_PORT/etc (dev local)
 *
 * SSL es OPCIONAL. Solo se activa si DB_SSL=true en el .env.
 * Para conexiones internas en Docker network NO se requiere SSL
 * (todo el tráfico es privado dentro de la red Docker).
 *
 * Si en el futuro conectas a una DB externa (AWS RDS, Heroku, etc.)
 * que SÍ requiere SSL, agrega DB_SSL=true al .env de esa instancia.
 */
function buildDbConfig(config: ConfigService): TypeOrmModuleOptions {
  const isProd = config.get('NODE_ENV') === 'production';
  const url = config.get<string>('DATABASE_URL');
  const useSsl = config.get<string>('DB_SSL') === 'true';

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
    // SSL solo si está explícitamente habilitado vía DB_SSL=true
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