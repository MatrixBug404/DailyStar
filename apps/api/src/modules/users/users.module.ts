import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  imports: [RbacModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
