import { Module } from '@nestjs/common';
import { PostgresFtsProvider } from './providers/postgres-fts.provider';

@Module({
  providers: [PostgresFtsProvider],
  exports: [PostgresFtsProvider],
})
export class SearchModule {}
