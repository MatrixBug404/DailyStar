import { Test, TestingModule } from '@nestjs/testing';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { JwtService } from '@nestjs/jwt';
import { PermissionResolverService } from '../rbac/permission-resolver.service';

describe('CategoriesController', () => {
  let controller: CategoriesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CategoriesController],
      providers: [
        { provide: CategoriesService, useValue: {} },
        { provide: JwtService, useValue: {} },
        { provide: PermissionResolverService, useValue: {} },
      ],
    }).compile();

    controller = module.get<CategoriesController>(CategoriesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('Permission Metadata', () => {
    const PERMISSIONS_KEY = 'permissions';

    it('should have undefined class-level permissions', () => {
      const classMetadata = Reflect.getMetadata(PERMISSIONS_KEY, CategoriesController);
      expect(classMetadata).toBeUndefined();
    });

    it('should require category.read on GET routes', () => {
      const findAllMetadata = Reflect.getMetadata(PERMISSIONS_KEY, CategoriesController.prototype.findAll);
      expect(findAllMetadata).toEqual(['category.read']);

      const findOneMetadata = Reflect.getMetadata(PERMISSIONS_KEY, CategoriesController.prototype.findOne);
      expect(findOneMetadata).toEqual(['category.read']);
    });

    it('should require category.manage on POST, PATCH, DELETE routes', () => {
      const createMetadata = Reflect.getMetadata(PERMISSIONS_KEY, CategoriesController.prototype.create);
      expect(createMetadata).toEqual(['category.manage']);

      const updateMetadata = Reflect.getMetadata(PERMISSIONS_KEY, CategoriesController.prototype.update);
      expect(updateMetadata).toEqual(['category.manage']);

      const removeMetadata = Reflect.getMetadata(PERMISSIONS_KEY, CategoriesController.prototype.remove);
      expect(removeMetadata).toEqual(['category.manage']);
    });
  });
});
