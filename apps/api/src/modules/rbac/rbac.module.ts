import { Module, Global } from '@nestjs/common';
import { PermissionResolverService } from './permission-resolver.service';

@Global()
@Module({
  providers: [PermissionResolverService],
  exports: [PermissionResolverService],
})
export class RbacModule {}
