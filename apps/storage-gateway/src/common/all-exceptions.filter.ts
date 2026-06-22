import {
  ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';

interface ErrorResponse {
  statusCode: number;
  timestamp: string;
  path: string;
  method: string;
  error: string;
  message: string | string[];
  /** Solo presente cuando son errores de validación */
  validation?: Array<{ field: string; constraints: string[] }>;
}

/**
 * Filtro de excepciones global.
 *
 * Beneficios:
 * - Respuestas de error consistentes (mismo shape para 400, 401, 500, etc.)
 * - Errores de validación expuestos con campo + restricciones legibles
 * - Stack traces ocultos al cliente (solo van al log del servidor)
 * - Logging estructurado para diagnóstico
 *
 * Útil tanto para producción (clientes ven errores limpios) como para
 * debugging (los logs tienen todo el contexto).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request  = ctx.getRequest<FastifyRequest>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? (exception as HttpException).getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const errorResponse: ErrorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      error: this.getErrorName(status),
      message: 'Error interno del servidor',
    };

    if (isHttpException) {
      const exceptionResponse = (exception as HttpException).getResponse();

      if (typeof exceptionResponse === 'string') {
        errorResponse.message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const resp = exceptionResponse as Record<string, any>;
        errorResponse.message = resp.message ?? errorResponse.message;
        if (resp.error)   errorResponse.error   = resp.error;

        // Si el message es un array, son errores de class-validator.
        // Los parseamos a un formato más legible.
        if (Array.isArray(resp.message)) {
          errorResponse.validation = this.parseValidationErrors(resp.message);
          errorResponse.message = 'Errores de validación en los datos enviados';
          errorResponse.error = 'Validation Error';
        }
      }
    } else if (exception instanceof Error) {
      // Errores no controlados: no exponemos detalles al cliente
      // pero los registramos en el log del servidor.
      this.logger.error(
        `${request.method} ${request.url} → ${exception.message}`,
        exception.stack,
      );
      errorResponse.message = 'Ocurrió un error inesperado. Intenta de nuevo más tarde.';
    } else {
      this.logger.error(
        `${request.method} ${request.url} → Excepción no estándar: ${JSON.stringify(exception)}`,
      );
    }

    // Log estructurado del error (útil para producción)
    if (status >= 500) {
      this.logger.error(`[${status}] ${request.method} ${request.url}`, exception);
    } else if (status >= 400) {
      this.logger.warn(
        `[${status}] ${request.method} ${request.url} → ${JSON.stringify(errorResponse.message)}`,
      );
    }

    response.status(status).send(errorResponse);
  }

  /**
   * Parsea los mensajes de class-validator en formato `{field}: error1, error2`
   * a un array más manejable para el cliente.
   *
   * Por defecto class-validator devuelve mensajes como:
   * - "orgId debe ser un UUID válido"
   * - "appSource debe ser uno de: departmentos, inventoryos"
   *
   * Como NestJS los pone planos en un array, perdemos la asociación
   * con el campo. Aquí simplemente los devolvemos como están — para
   * un parseo más estructurado habría que usar `exceptionFactory` en
   * el ValidationPipe (más complejo, lo dejamos para v2).
   */
  private parseValidationErrors(messages: string[]): Array<{ field: string; constraints: string[] }> {
    return [{ field: '*', constraints: messages }];
  }

  private getErrorName(status: number): string {
    const names: Record<number, string> = {
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      409: 'Conflict',
      413: 'Payload Too Large',
      415: 'Unsupported Media Type',
      422: 'Unprocessable Entity',
      500: 'Internal Server Error',
      502: 'Bad Gateway',
      503: 'Service Unavailable',
    };
    return names[status] || 'Error';
  }
}
