import {
  Injectable, Logger, NotFoundException, InternalServerErrorException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const stat   = promisify(fs.stat);
const mkdir  = promisify(fs.mkdir);
const unlink = promisify(fs.unlink);
const access = promisify(fs.access);

/**
 * Servicio para gestionar archivos en el storage TEMPORAL del gateway.
 *
 * "Temporal" porque estos archivos están sujetos a:
 * - Políticas de retención (90 días default, 30 si vino de error)
 * - Housekeeping automático que los elimina al expirar
 *
 * Path layout en disco:
 *   <baseDir>/<orgId>/<appSource>/<entityType>/<timestamp>_<filename>
 *
 * Donde <baseDir> es:
 * - Dev: ./temp-storage/      (relativo al cwd del proceso)
 * - Prod: /var/lib/suite-storage/temp (montado como volume Docker)
 *
 * Configurable vía env var TEMP_STORAGE_DIR.
 *
 * Por qué jerarquía con orgId al inicio:
 * - Limpieza por org (cuando un cliente nos pide eliminar TODO lo suyo)
 * - Inspección manual más fácil
 * - Cuotas por org en el futuro (du -sh <orgId>/)
 *
 * Cuando este servicio se migre a S3/MinIO en el futuro, solo cambia
 * la implementación interna. La interfaz pública (write/read/delete)
 * se mantiene igual.
 */
@Injectable()
export class LocalStorageService {
  private readonly logger = new Logger(LocalStorageService.name);
  private readonly baseDir: string;

  constructor() {
    this.baseDir = path.resolve(
      process.env.TEMP_STORAGE_DIR || './temp-storage',
    );
    this.ensureBaseDirSync();
    this.logger.log(`📁 Storage temporal en: ${this.baseDir}`);
  }

  private ensureBaseDirSync(): void {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
      this.logger.log(`Creado directorio base: ${this.baseDir}`);
    }
  }

  /**
   * Construye el path relativo (sin baseDir) para un archivo.
   *
   * Path relativo se guarda en DB (file_references.internal_path)
   * y se resuelve a absoluto cuando se necesita leer/escribir.
   *
   * Por qué relativo: si en el futuro mueves el baseDir, los registros
   * en DB siguen siendo válidos.
   */
  buildRelativePath(args: {
    orgId: string;
    appSource: string;
    entityType: string;
    fileName: string;
  }): string {
    // Sanitizamos el filename para evitar path traversal (../../etc/passwd)
    const safeName = path.basename(args.fileName);
    const timestamp = Date.now();
    return path.join(
      args.orgId,
      args.appSource,
      args.entityType,
      `${timestamp}_${safeName}`,
    );
  }

  /** Resuelve path relativo a absoluto y verifica que esté DENTRO de baseDir. */
  private toAbsolute(relativePath: string): string {
    const abs = path.resolve(this.baseDir, relativePath);
    // Guard contra path traversal: el path resuelto debe empezar con baseDir
    if (!abs.startsWith(this.baseDir + path.sep) && abs !== this.baseDir) {
      throw new InternalServerErrorException(
        `Path inválido: ${relativePath} apunta fuera del directorio permitido`,
      );
    }
    return abs;
  }

  /**
   * Escribe un buffer en disco. Crea los subdirectorios necesarios.
   * Devuelve el path RELATIVO (para guardar en DB).
   */
  async write(args: {
    orgId: string;
    appSource: string;
    entityType: string;
    fileName: string;
    buffer: Buffer;
  }): Promise<{ relativePath: string; absolutePath: string; sizeBytes: number }> {
    const relativePath = this.buildRelativePath(args);
    const absolutePath = this.toAbsolute(relativePath);

    // Crear subdirectorios
    await mkdir(path.dirname(absolutePath), { recursive: true });

    // Escribir el archivo
    await fs.promises.writeFile(absolutePath, args.buffer);

    this.logger.debug(
      `✏️  Escrito: ${relativePath} (${args.buffer.length} bytes)`,
    );

    return {
      relativePath,
      absolutePath,
      sizeBytes: args.buffer.length,
    };
  }

  /**
   * Lee un archivo del disco a un Buffer.
   *
   * Lanza NotFoundException si no existe (útil para casos donde el
   * housekeeping ya lo eliminó pero la DB aún lo referencia, o si
   * alguien borró el archivo manualmente).
   */
  async read(relativePath: string): Promise<Buffer> {
    const absolutePath = this.toAbsolute(relativePath);

    try {
      await access(absolutePath, fs.constants.R_OK);
    } catch {
      throw new NotFoundException(
        `Archivo temporal no encontrado: ${relativePath}`,
      );
    }

    return fs.promises.readFile(absolutePath);
  }

  /**
   * Verifica si un archivo existe sin leerlo.
   * Útil para validar antes de servirlo o reintentar el upload.
   */
  async exists(relativePath: string): Promise<boolean> {
    try {
      const absolutePath = this.toAbsolute(relativePath);
      await access(absolutePath, fs.constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Obtiene metadata del archivo (tamaño, mtime) sin leerlo.
   * Devuelve null si no existe.
   */
  async getMetadata(relativePath: string): Promise<{
    sizeBytes: number;
    modifiedAt: Date;
  } | null> {
    try {
      const absolutePath = this.toAbsolute(relativePath);
      const stats = await stat(absolutePath);
      return {
        sizeBytes: stats.size,
        modifiedAt: stats.mtime,
      };
    } catch {
      return null;
    }
  }

  /**
   * Elimina un archivo del disco.
   * No lanza error si no existía (idempotente).
   */
  async delete(relativePath: string): Promise<boolean> {
    try {
      const absolutePath = this.toAbsolute(relativePath);
      await unlink(absolutePath);
      this.logger.debug(`🗑️  Eliminado: ${relativePath}`);
      return true;
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        this.logger.debug(`(skip delete) Archivo no existía: ${relativePath}`);
        return false;
      }
      this.logger.warn(`Error eliminando ${relativePath}: ${err.message}`);
      return false;
    }
  }

  /**
   * Devuelve el path absoluto para streamear directamente (útil en el
   * controller cuando responde un archivo grande sin cargarlo todo en RAM).
   *
   * Verifica primero que el archivo existe y está dentro de baseDir.
   */
  async getAbsolutePathForStream(relativePath: string): Promise<string> {
    const absolutePath = this.toAbsolute(relativePath);
    if (!(await this.exists(relativePath))) {
      throw new NotFoundException(
        `Archivo temporal no encontrado: ${relativePath}`,
      );
    }
    return absolutePath;
  }

  /**
   * Stats globales del storage temporal (para diagnóstico).
   * Cuenta archivos y suma tamaños recursivamente.
   */
  async getStats(): Promise<{ files: number; totalBytes: number; baseDir: string }> {
    let files = 0;
    let totalBytes = 0;

    const walk = async (dir: string): Promise<void> => {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          files++;
          const s = await stat(fullPath);
          totalBytes += s.size;
        }
      }
    };

    try {
      await walk(this.baseDir);
    } catch (err: any) {
      this.logger.warn(`Error leyendo stats: ${err.message}`);
    }

    return { files, totalBytes, baseDir: this.baseDir };
  }
}
