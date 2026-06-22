import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter, NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { Logger as PinoLogger } from 'nestjs-pino';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import multipart from '@fastify/multipart';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
    {
      // bufferLogs evita perder los logs del arranque antes
      // de que pino esté listo. Luego los flusheamos al activarlo.
      bufferLogs: true,
    },
  );

  // Activar pino como logger global de NestJS
  // Esto hace que TODOS los Logger() de NestJS y los nuestros usen pino.
  app.useLogger(app.get(PinoLogger));

  // ── Multipart (uploads) ──────────────────────────────────────
  await app.register(multipart as any, {
    limits: {
      fileSize: 50 * 1024 * 1024,
      files: 2,
      fields: 20,
    },
  });

  // ── CORS ─────────────────────────────────────────────────────
  app.enableCors({
    origin: process.env.CORS_ORIGINS?.split(',') || true,
    credentials: true,
  });

  // ── Prefix global ────────────────────────────────────────────
  app.setGlobalPrefix('api/v1');

  // ── Validación global con class-validator ───────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      stopAtFirstError: false,
    }),
  );

  // ── Filtro de excepciones global ────────────────────────────
  app.useGlobalFilters(new AllExceptionsFilter());

  // ── Swagger ──────────────────────────────────────────────────
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Suite-OS Storage Gateway')
    .setDescription('Microservicio BYOS (Bring Your Own Storage) para apps de Suite-OS')
    .setVersion('1.0.0')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-api-key' }, 'internal-api-key')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  // ── Arranque ─────────────────────────────────────────────────
  const port = parseInt(process.env.PORT || '3100');
  await app.listen(port, '0.0.0.0');

  // Usar el logger de pino para el mensaje final
  const logger = app.get(PinoLogger);
  logger.log(`Storage Gateway corriendo en puerto ${port}`);
  logger.log(`Swagger disponible en http://localhost:${port}/docs`);
  logger.log(`Ambiente: ${process.env.NODE_ENV || 'development'}`);
}

bootstrap().catch((err) => {
  console.error('Error fatal al arrancar:', err);
  process.exit(1);
});
