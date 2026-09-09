import { Controller, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { TagsService } from './tags.service';
import { UpdateTagDto } from './dto/update-tag.dto';
import { RequirePermission } from '../rbac/decorators/require-permission.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { PermissionGuard } from '../rbac/guards/permission.guard';

@Controller('v1/tags')
@UseGuards(AuthGuard, PermissionGuard)
@RequirePermission('tag.manage')
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateTagDto: UpdateTagDto) {
    return this.tagsService.update(id, updateTagDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.tagsService.remove(id);
  }
}
