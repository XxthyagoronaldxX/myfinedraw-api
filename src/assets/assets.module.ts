import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { mkdirSync, unlink } from 'fs';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { AuthGuard } from '../auth/auth.module';
import { AuthUser, CurrentUser, OwnershipService } from '../common/common.module';
import { PrismaService } from '../prisma/prisma.module';

/**
 * Armazenamento local em disco (dev). Trocar por S3/MinIO em produção:
 * basta substituir o storage do multer e o cálculo de `url`.
 */
const UPLOAD_DIR = join(process.cwd(), process.env.UPLOAD_DIR ?? 'uploads');
mkdirSync(UPLOAD_DIR, { recursive: true });
const ALLOWED = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];

const toDto = (a: { id: string; fileKey: string; fileName: string; mimeType: string; size: number; createdAt: Date }) => ({
  id: a.id,
  url: `/uploads/${a.fileKey}`,
  fileName: a.fileName,
  mimeType: a.mimeType,
  size: a.size,
  createdAt: a.createdAt,
});

@Injectable()
export class AssetsService {
  constructor(private prisma: PrismaService, private own: OwnershipService) {}

  async list(projectId: string, userId: string) {
    await this.own.project(projectId, userId);
    const assets = await this.prisma.asset.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } });
    return assets.map(toDto);
  }

  async create(projectId: string, userId: string, file: Express.Multer.File) {
    try {
      await this.own.project(projectId, userId);
    } catch (e) {
      unlink(file.path, () => undefined);
      throw e;
    }
    const asset = await this.prisma.asset.create({
      data: { projectId, fileKey: file.filename, fileName: file.originalname, mimeType: file.mimetype, size: file.size },
    });
    return toDto(asset);
  }

  async remove(id: string, userId: string) {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) throw new BadRequestException('Asset não encontrado');
    await this.own.project(asset.projectId, userId);
    await this.prisma.asset.delete({ where: { id } });
    unlink(join(UPLOAD_DIR, asset.fileKey), () => undefined);
    return { ok: true };
  }
}

@UseGuards(AuthGuard)
@Controller()
export class AssetsController {
  constructor(private assets: AssetsService) {}

  @Get('projects/:projectId/assets')
  list(@CurrentUser() u: AuthUser, @Param('projectId') projectId: string) {
    return this.assets.list(projectId, u.id);
  }

  @Post('projects/:projectId/assets')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: UPLOAD_DIR,
        filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`),
      }),
      limits: { fileSize: Number(process.env.MAX_UPLOAD_MB ?? 10) * 1024 * 1024 },
      fileFilter: (_req, file, cb) =>
        ALLOWED.includes(file.mimetype) ? cb(null, true) : cb(new BadRequestException('Formato não suportado'), false),
    }),
  )
  upload(@CurrentUser() u: AuthUser, @Param('projectId') projectId: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Envie o arquivo no campo "file"');
    return this.assets.create(projectId, u.id, file);
  }

  @Delete('assets/:id')
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.assets.remove(id, u.id);
  }
}

@Module({ controllers: [AssetsController], providers: [AssetsService] })
export class AssetsModule {}
