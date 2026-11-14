import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { IsDateString, IsIn, IsInt, IsObject, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { AuthGuard } from '../auth/auth.module';
import { AuthUser, CurrentUser, OwnershipService } from '../common/common.module';
import { PrismaService } from '../prisma/prisma.module';
import { BoardContent, emptyContent, exportSql, importSql } from './sql';

const BOARD_TYPES = ['mixed', 'er', 'flow'] as const;
type BoardType = (typeof BOARD_TYPES)[number];

export class CreateBoardDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsOptional() @IsIn(BOARD_TYPES) type?: BoardType;
}

export class UpdateBoardDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsIn(BOARD_TYPES) type?: BoardType;
  @IsOptional() @IsInt() @Min(0) position?: number;
}

export class SaveContentDto {
  @IsObject() content!: BoardContent;
  /** updatedAt conhecido pelo cliente; se o board mudou depois disso, retorna 409. */
  @IsOptional() @IsDateString() baseUpdatedAt?: string;
}

export class ImportSqlDto {
  @IsString() sql!: string;
}

@Injectable()
export class BoardsService {
  constructor(private prisma: PrismaService, private own: OwnershipService) {}

  async list(projectId: string, userId: string) {
    await this.own.project(projectId, userId);
    return this.prisma.board.findMany({
      where: { projectId },
      orderBy: { position: 'asc' },
      select: { id: true, name: true, type: true, position: true, updatedAt: true, thumbnailUrl: true },
    });
  }

  async create(projectId: string, userId: string, dto: CreateBoardDto) {
    await this.own.project(projectId, userId);
    const count = await this.prisma.board.count({ where: { projectId } });
    return this.prisma.board.create({
      data: { projectId, name: dto.name, type: dto.type ?? 'mixed', position: count, content: emptyContent() },
    });
  }

  async get(id: string, userId: string) {
    const { project, ...board } = await this.own.board(id, userId);
    return { ...board, projectName: project.name };
  }

  async update(id: string, userId: string, dto: UpdateBoardDto) {
    await this.own.board(id, userId);
    return this.prisma.board.update({ where: { id }, data: dto });
  }

  async saveContent(id: string, userId: string, dto: SaveContentDto) {
    const board = await this.own.board(id, userId);
    if (dto.baseUpdatedAt && board.updatedAt.getTime() > new Date(dto.baseUpdatedAt).getTime()) {
      throw new ConflictException('O board foi alterado em outra aba. Recarregue a página.');
    }
    const saved = await this.prisma.board.update({
      where: { id },
      data: { content: dto.content as any },
      select: { id: true, updatedAt: true },
    });
    await this.prisma.project.update({ where: { id: board.projectId }, data: { updatedAt: new Date() } });
    return saved;
  }

  async duplicate(id: string, userId: string) {
    const board = await this.own.board(id, userId);
    const count = await this.prisma.board.count({ where: { projectId: board.projectId } });
    return this.prisma.board.create({
      data: {
        projectId: board.projectId,
        name: `${board.name} (cópia)`,
        type: board.type,
        position: count,
        content: board.content as any,
      },
    });
  }

  async remove(id: string, userId: string) {
    await this.own.board(id, userId);
    await this.prisma.board.delete({ where: { id } });
    return { ok: true };
  }

  async importSql(id: string, userId: string, sql: string) {
    await this.own.board(id, userId);
    return importSql(sql);
  }

  async exportSql(id: string, userId: string) {
    const board = await this.own.board(id, userId);
    return { sql: exportSql(board.content as unknown as BoardContent) };
  }
}

@UseGuards(AuthGuard)
@Controller()
export class BoardsController {
  constructor(private boards: BoardsService) {}

  @Get('projects/:projectId/boards')
  list(@CurrentUser() u: AuthUser, @Param('projectId') projectId: string) {
    return this.boards.list(projectId, u.id);
  }

  @Post('projects/:projectId/boards')
  create(@CurrentUser() u: AuthUser, @Param('projectId') projectId: string, @Body() dto: CreateBoardDto) {
    return this.boards.create(projectId, u.id, dto);
  }

  @Get('boards/:id')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.boards.get(id, u.id);
  }

  @Patch('boards/:id')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateBoardDto) {
    return this.boards.update(id, u.id, dto);
  }

  @Put('boards/:id/content')
  save(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: SaveContentDto) {
    return this.boards.saveContent(id, u.id, dto);
  }

  @Post('boards/:id/duplicate')
  duplicate(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.boards.duplicate(id, u.id);
  }

  @Delete('boards/:id')
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.boards.remove(id, u.id);
  }

  /** Converte DDL em nós/arestas ER; o cliente adiciona ao canvas e salva. */
  @Post('boards/:id/import/sql')
  importSql(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ImportSqlDto) {
    return this.boards.importSql(id, u.id, dto.sql);
  }

  @Get('boards/:id/export/sql')
  exportSql(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.boards.exportSql(id, u.id);
  }
}

@Module({ controllers: [BoardsController], providers: [BoardsService] })
export class BoardsModule {}
