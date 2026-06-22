import { Injectable, Inject, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';
import { GoogleTokens } from '../providers/google-drive/google-drive.types';

@Injectable()
export class OAuthCacheService {
  private readonly logger = new Logger(OAuthCacheService.name);

  // Los access_token de Google duran 1 hora (3600s).
  // Cacheamos por 50 minutos (3000s) para tener margen antes que expiren.
  private readonly TTL_SECONDS = 3000;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private buildKey(orgId: string, appSource: string): string {
    return `oauth:tokens:${appSource}:${orgId}`;
  }

  async get(orgId: string, appSource: string): Promise<GoogleTokens | null> {
    try {
      const cached = await this.redis.get(this.buildKey(orgId, appSource));
      if (!cached) {
        this.logger.debug(`Cache MISS: ${orgId}/${appSource}`);
        return null;
      }
      this.logger.debug(`Cache HIT: ${orgId}/${appSource}`);
      return JSON.parse(cached);
    } catch (err) {
      // Si Redis falla, no rompemos el flujo, simplemente vamos a DB
      this.logger.warn(`Error leyendo cache: ${err.message}`);
      return null;
    }
  }

  async set(orgId: string, appSource: string, tokens: GoogleTokens): Promise<void> {
    try {
      await this.redis.set(
        this.buildKey(orgId, appSource),
        JSON.stringify(tokens),
        'EX',
        this.TTL_SECONDS,
      );
      this.logger.debug(`Cache SET: ${orgId}/${appSource} (TTL ${this.TTL_SECONDS}s)`);
    } catch (err) {
      this.logger.warn(`Error guardando en cache: ${err.message}`);
    }
  }

  async invalidate(orgId: string, appSource: string): Promise<void> {
    try {
      await this.redis.del(this.buildKey(orgId, appSource));
      this.logger.log(`Cache invalidado: ${orgId}/${appSource}`);
    } catch (err) {
      this.logger.warn(`Error invalidando cache: ${err.message}`);
    }
  }

  /**
   * Invalida TODOS los caches de una org (útil al desconectar Drive).
   */
  async invalidateAll(orgId: string): Promise<void> {
    try {
      const pattern = `oauth:tokens:*:${orgId}`;
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
        this.logger.log(`Cache invalidado: ${keys.length} entradas de ${orgId}`);
      }
    } catch (err) {
      this.logger.warn(`Error invalidando cache: ${err.message}`);
    }
  }
}
