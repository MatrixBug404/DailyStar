import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { RequirePermission } from '../rbac/decorators/require-permission.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { PermissionGuard } from '../rbac/guards/permission.guard';

@Controller('v1/categories')
@UseGuards(AuthGuard, PermissionGuard)
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post()
  @RequirePermission('category.manage')
  create(@Body() createCategoryDto: CreateCategoryDto) {
    return this.categoriesService.create(createCategoryDto);
  }

  @Get()
  @RequirePermission('category.read')
  findAll() {
    return this.categoriesService.findAll();
  }

  @Get(':id')
  @RequirePermission('category.read')
  findOne(@Param('id') id: string) {
    return this.categoriesService.findOne(id);
  }

  @Patch(':id')
  @RequirePermission('category.manage')
  update(@Param('id') id: string, @Body() updateCategoryDto: UpdateCategoryDto) {
    return this.categoriesService.update(id, updateCategoryDto);
  }

  @Delete(':id')
  @RequirePermission('category.manage')
  remove(@Param('id') id: string) {
    return this.categoriesService.remove(id);
  }
}
