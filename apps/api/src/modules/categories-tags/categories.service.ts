import { ConflictException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { prisma } from '../../database/client';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { generateSlug } from '../articles/slug.util';

@Injectable()
export class CategoriesService {

  async create(createCategoryDto: CreateCategoryDto) {
    let slug = createCategoryDto.slug ? generateSlug(createCategoryDto.slug) : generateSlug(createCategoryDto.name);
    
    // Check global uniqueness
    const existing = await prisma.category.findUnique({ where: { slug } });
    if (existing) {
      throw new ConflictException('CATEGORY_SLUG_CONFLICT');
    }

    // Check hierarchy depth
    if (createCategoryDto.parentId) {
      await this.verifyDepthLimit(createCategoryDto.parentId);
    }

    return prisma.category.create({
      data: {
        name: createCategoryDto.name,
        slug,
        parentId: createCategoryDto.parentId,
      },
    });
  }

  async findAll() {
    return prisma.category.findMany({
      include: { children: true }
    });
  }

  async findOne(id: string) {
    const category = await prisma.category.findUnique({
      where: { id },
      include: { children: true, parent: true }
    });
    if (!category) throw new NotFoundException();
    return category;
  }

  async update(id: string, updateCategoryDto: UpdateCategoryDto) {
    const category = await prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException();

    let slug = category.slug;
    if (updateCategoryDto.slug || updateCategoryDto.name) {
      slug = updateCategoryDto.slug ? generateSlug(updateCategoryDto.slug) : generateSlug(updateCategoryDto.name || category.name);
      if (slug !== category.slug) {
        const existing = await prisma.category.findUnique({ where: { slug } });
        if (existing) throw new ConflictException('CATEGORY_SLUG_CONFLICT');
      }
    }

    if (updateCategoryDto.parentId !== undefined && updateCategoryDto.parentId !== category.parentId) {
      if (updateCategoryDto.parentId === id) throw new BadRequestException('Cannot parent to self');
      if (updateCategoryDto.parentId) {
        await this.verifyDepthLimit(updateCategoryDto.parentId, id);
      }
    }

    return prisma.category.update({
      where: { id },
      data: {
        name: updateCategoryDto.name,
        slug,
        parentId: updateCategoryDto.parentId,
      },
    });
  }

  async remove(id: string) {
    const category = await prisma.category.findUnique({
      where: { id },
      include: {
        _count: {
          select: { children: true, articles: true }
        }
      }
    });

    if (!category) throw new NotFoundException();

    if (category._count.children > 0 || category._count.articles > 0) {
      throw new ConflictException('CATEGORY_IN_USE');
    }

    await prisma.category.delete({ where: { id } });
  }

  private async verifyDepthLimit(parentId: string, movingCategoryId?: string) {
    let currentId = parentId;
    let depth = 1;
    
    while (currentId) {
      if (currentId === movingCategoryId) {
        throw new BadRequestException('Circular category dependency');
      }
      
      const cat = await prisma.category.findUnique({ where: { id: currentId } });
      if (!cat) throw new BadRequestException('INVALID_REFERENCE');
      
      depth++;
      if (depth > 3) {
        throw new BadRequestException('Category hierarchy depth limit (3) exceeded');
      }
      currentId = cat.parentId as string;
    }
  }
}

