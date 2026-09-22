import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '../../database/client';
import { UpdateTagDto } from './dto/update-tag.dto';
import { generateSlug } from '../articles/slug.util';

@Injectable()
export class TagsService {
  async findOrCreate(names: string[]) {
    const uniqueNames = Array.from(new Set(names));
    const tags = [];

    for (const name of uniqueNames) {
      const slug = generateSlug(name);
      if (!slug) continue;

      let tag = await prisma.tag.findUnique({ where: { slug } });
      if (!tag) {
        try {
          tag = await prisma.tag.create({ data: { name, slug } });
        } catch (e) {
          tag = await prisma.tag.findUnique({ where: { slug } });
        }
      }
      if (tag) tags.push(tag);
    }

    return tags;
  }

  async update(id: string, updateTagDto: UpdateTagDto) {
    const tag = await prisma.tag.findUnique({ where: { id } });
    if (!tag) throw new NotFoundException();

    const slug = generateSlug(updateTagDto.name);
    if (slug !== tag.slug) {
      const existing = await prisma.tag.findUnique({ where: { slug } });
      if (existing) throw new ConflictException('TAG_SLUG_CONFLICT');
    }

    return prisma.tag.update({
      where: { id },
      data: { name: updateTagDto.name, slug },
    });
  }

  async remove(id: string) {
    const tag = await prisma.tag.findUnique({ where: { id } });
    if (!tag) throw new NotFoundException();

    await prisma.tag.delete({ where: { id } });
  }
}
