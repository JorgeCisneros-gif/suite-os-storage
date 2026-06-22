import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MaintenanceJob } from './maintenance.job';
import { StorageModule } from '../storage/storage.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { GoogleDriveModule } from '../providers/google-drive/google-drive.module';
import { StorageProvider } from '../storage/entities/storage-provider.entity';
import { FileReference } from '../storage/entities/file-reference.entity';

@Module({
  imports: [
    // Registrar las entidades que MaintenanceJob inyecta directamente
    // como repositorios. Aunque StorageModule también las registra,
    // las inyecciones de TypeORM son por módulo: hay que registrarlas
    // explícitamente aquí también para que estén disponibles en el
    // contexto de JobsModule.
    TypeOrmModule.forFeature([StorageProvider, FileReference]),

    // Módulos de los servicios que MaintenanceJob usa
    StorageModule,
    NotificationsModule,
    GoogleDriveModule,
  ],
  providers: [MaintenanceJob],
})
export class JobsModule {}
