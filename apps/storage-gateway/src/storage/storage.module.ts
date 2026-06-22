import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StorageService } from './storage.service';
import { StorageController } from './storage.controller';
import { LocalStorageService } from './local-storage.service';
import { StorageProvider } from './entities/storage-provider.entity';
import { FileReference } from './entities/file-reference.entity';
import { GoogleDriveModule } from '../providers/google-drive/google-drive.module';
import { CredentialsModule } from '../credentials/credentials.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([StorageProvider, FileReference]),
    GoogleDriveModule,
    CredentialsModule,
  ],
  providers: [StorageService, LocalStorageService],
  controllers: [StorageController],
  exports: [StorageService, LocalStorageService],
})
export class StorageModule {}
