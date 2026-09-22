import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { MinioStorageService } from './storage/minio-storage.service';
import { STORAGE_SERVICE } from './storage/storage.service.interface';

@Module({
  imports: [
    ConfigModule,
    MulterModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        storage: memoryStorage(),
        limits: {
          fileSize: configService.get<number>('media.maxFileSizeBytes') ?? 10485760,
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [MediaController],
  providers: [
    MediaService,
    {
      provide: STORAGE_SERVICE,
      useClass: MinioStorageService,
    },
  ],
  exports: [MediaService],
})
export class MediaModule {}
