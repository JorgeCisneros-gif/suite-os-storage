import { Module, RequestMethod } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'crypto';
import { IncomingMessage, ServerResponse } from 'http';

/**
 * Configuración global de logs estructurados con pino.
 *
 * Comportamientos clave:
 * - DEVELOPMENT: salida pretty-printed (colores, timestamps legibles)
 * - PRODUCTION: salida JSON (parseable por Loki/Datadog/CloudWatch)
 * - Cada request HTTP recibe un `reqId` único
 * - Auto-log de requests HTTP (método, url, status, duración)
 * - Redacción automática de datos sensibles (tokens, claves)
 * - Health checks y /docs excluidos para no saturar logs
 *
 * Nivel configurable vía LOG_LEVEL en .env.
 */
@Module({
  imports: [
    LoggerModule.forRoot({
      // ── EXCLUDE: rutas que NO se loguean automáticamente ────
      //
      // Es la forma CORRECTA de excluir rutas en nestjs-pino. Funciona
      // como un middleware NestJS, así que respeta el prefix global
      // (api/v1) y los paths reales del router.
      //
      // Usar autoLogging.ignore NO funciona bien con Fastify + NestJS
      // porque req.url se reescribe a '/' en el contexto del middleware.
      exclude: [
        { method: RequestMethod.GET, path: 'health' },
        { method: RequestMethod.GET, path: 'docs' },
        { method: RequestMethod.GET, path: 'docs/(.*)' },
      ],

      pinoHttp: {
        level:
          process.env.LOG_LEVEL ||
          (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),

        transport:
          process.env.NODE_ENV !== 'production'
            ? {
                target: 'pino-pretty',
                options: {
                  colorize: true,
                  singleLine: false,
                  translateTime: 'SYS:HH:MM:ss.l',
                  ignore: 'pid,hostname,reqId,req,res,responseTime',
                  messageFormat:
                    '{if reqId}[{reqId}] {end}{if context}({context}) {end}{msg}',
                },
              }
            : undefined,

        genReqId: (req: any) => {
          const existing =
            req.headers['x-request-id'] || req.headers['x-correlation-id'];
          return existing ? String(existing) : randomUUID();
        },

        customAttributeKeys: {
          req: 'request',
          res: 'response',
          err: 'error',
          responseTime: 'duration_ms',
          reqId: 'reqId',
        },

        serializers: {
          req: (req: IncomingMessage) => ({
            method: req.method,
            url: req.url,
            userAgent: req.headers['user-agent'],
            contentLength: req.headers['content-length'],
            contentType: req.headers['content-type'],
          }),
          res: (res: ServerResponse) => ({
            statusCode: res.statusCode,
          }),
        },

        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers["x-api-key"]',
            'req.headers.cookie',
            'request.headers.authorization',
            'request.headers["x-api-key"]',
            '*.access_token',
            '*.refresh_token',
            '*.credentials',
            '*.password',
            'req.body.password',
            'req.body.credentials',
          ],
          censor: '[REDACTED]',
        },

        customSuccessMessage: (req, res) => {
          return `${req.method} ${(req as any).url} → ${res.statusCode}`;
        },

        customErrorMessage: (req, res, err) => {
          return `${req.method} ${(req as any).url} → ${res.statusCode} (${err.message})`;
        },

        customLogLevel: (req, res, err) => {
          if (err || res.statusCode >= 500) return 'error';
          if (res.statusCode >= 400) return 'warn';
          return 'info';
        },
      },
    }),
  ],
})
export class LoggingModule {}
