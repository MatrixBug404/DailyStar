import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ArticlesModule } from './modules/articles/articles.module';
import { CategoriesTagsModule } from './modules/categories-tags/categories-tags.module';
import { AuditModule } from './modules/audit/audit.module';
import { WorkflowModule } from './modules/workflow/workflow.module';

/**
 * Root application module.
 *
 * Phase 0: Only AppController (health endpoint) and ConfigModule are registered.
 * Future modules (AuthModule, UsersModule, ArticlesModule, etc.) will be added
 * in their respective phases per the architecture specification (Section 13).
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env', '.env.local'],
    }),
    UsersModule,
    AuthModule,
    ArticlesModule,
    CategoriesTagsModule,
    AuditModule,
    WorkflowModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
