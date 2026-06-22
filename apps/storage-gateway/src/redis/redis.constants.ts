/**
 * Token de inyección para el cliente Redis.
 * Se mantiene en archivo separado para evitar dependencias circulares
 * entre redis.module.ts y oauth-cache.service.ts.
 */
export const REDIS_CLIENT = 'REDIS_CLIENT';
