import { Body, Controller, Delete, Get, Injectable, Module, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsArray, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { AuthGuard } from '../auth/auth.module';
import { emptyContent } from '../boards/sql';
import { AuthUser, CurrentUser, OwnershipService } from '../common/common.module';
import { PrismaService } from '../prisma/prisma.module';

export class CreateProjectDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/) color?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
}

export class UpdateProjectDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/) color?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
}

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService, private own: OwnershipService) {}

  list(userId: string, q?: string, tag?: string) {
    return this.prisma.project.findMany({
      where: {
        ownerId: userId,
        ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
        ...(tag ? { tags: { has: tag } } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { boards: true } } },
    });
  }

  create(userId: string, dto: CreateProjectDto) {
    return this.prisma.project.create({
      data: { ...dto, ownerId: userId, boards: { create: { name: 'Board 1', content: emptyContent() } } },
    });
  }

  async get(id: string, userId: string) {
    await this.own.project(id, userId);
    return this.prisma.project.findUnique({
      where: { id },
      include: {
        boards: {
          orderBy: { position: 'asc' },
          select: { id: true, name: true, type: true, position: true, updatedAt: true, thumbnailUrl: true },
        },
      },
    });
  }

  async update(id: string, userId: string, dto: UpdateProjectDto) {
    await this.own.project(id, userId);
    return this.prisma.project.update({ where: { id }, data: dto });
  }

  async remove(id: string, userId: string) {
    await this.own.project(id, userId);
    await this.prisma.project.delete({ where: { id } });
    return { ok: true };
  }

  async export(id: string, userId: string) {
    await this.own.project(id, userId);
    return this.prisma.project.findUnique({ where: { id }, include: { boards: true, assets: true } });
  }
}

@UseGuards(AuthGuard)
@Controller('projects')
export class ProjectsController {
  constructor(private projects: ProjectsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query('q') q?: string, @Query('tag') tag?: string) {
    return this.projects.list(u.id, q, tag);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateProjectDto) {
    return this.projects.create(u.id, dto);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.projects.get(id, u.id);
  }

  @Patch(':id')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateProjectDto) {
    return this.projects.update(id, u.id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.projects.remove(id, u.id);
  }

  @Get(':id/export')
  export(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.projects.export(id, u.id);
  }
}

@Module({ controllers: [ProjectsController], providers: [ProjectsService] })
export class ProjectsModule {}
