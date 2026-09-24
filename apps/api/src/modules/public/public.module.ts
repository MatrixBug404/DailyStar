import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';
import { SearchModule } from '../search/search.module';

@Module({
  imports: [SearchModule],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
