import { Module, Global, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';
import { OAuthCacheService } from './oauth-cache.service';
import { REDIS_CLIENT } from './redis.constants';

// Re-exportamos para mantener compatibilidad
export { REDIS_CLIENT } from './redis.constants';

/**
 * Configuración Redis con dos modos:
 *
 * 1. REDIS_URL completa (modo Docker / producción):
 *    REDIS_URL=redis://:password@host:6379
 *
 * 2. Variables separadas (modo dev local):
 *    REDIS_HOST=localhost
 *    REDIS_PORT=6379
 *    REDIS_PASSWORD=...
 *
 * Si REDIS_URL está presente, tiene prioridad.
 */
function buildRedisClient(config: ConfigService, logger: Logger): Redis {
  const url = config.get<string>('REDIS_URL');

  const commonOptions: RedisOptions = {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  };

  // Modo URL (Docker/prod)
  if (url && url.trim() !== '') {
    return new Redis(url, commonOptions);
  }

  // Modo variables separadas (dev local)
  const host = config.get<string>('REDIS_HOST') || 'localhost';
  const port = parseInt(config.get<string>('REDIS_PORT') || '6379', 10);
  const password = config.get<string>('REDIS_PASSWORD');

  logger.log(
    `Conectando a Redis en ${host}:${port}${password ? ' con auth' : ' sin auth'}`,
  );

  return new Redis({
    ...commonOptions,
    host,
    port,
    password: password || undefined,  // si está vacío, no enviar password
  });
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const logger = new Logger('RedisClient');
        const client = buildRedisClient(config, logger);

        client.on('connect', () => logger.log('Redis conectado'));
        client.on('error', (err) => logger.error(`Redis error: ${err.message}`));
        client.on('close', () => logger.warn('Conexión Redis cerrada'));
        client.on('reconnecting', () => logger.log('Reconectando a Redis...'));

        return client;
      },
    },
    OAuthCacheService,
  ],
  exports: [REDIS_CLIENT, OAuthCacheService],
})
export class RedisModule {}
