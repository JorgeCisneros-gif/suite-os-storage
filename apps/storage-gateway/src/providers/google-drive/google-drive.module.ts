import { Module } from '@nestjs/common';
import { GoogleDriveService } from './google-drive.service';
import { CredentialsModule } from '../../credentials/credentials.module';

@Module({
  imports: [CredentialsModule],
  providers: [GoogleDriveService],
  exports: [GoogleDriveService],
})
export class GoogleDriveModule {}
