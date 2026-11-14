import {
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Global,
  Injectable,
  Module,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.module';

export interface AuthUser {
  id: string;
  email: string;
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);

/** Garante que o recurso pertence ao usuário autenticado. */
@Injectable()
export class OwnershipService {
  constructor(private prisma: PrismaService) {}

  async project(projectId: string, userId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Projeto não encontrado');
    if (project.ownerId !== userId) throw new ForbiddenException();
    return project;
  }

  async board(boardId: string, userId: string) {
    const board = await this.prisma.board.findUnique({ where: { id: boardId }, include: { project: true } });
    if (!board) throw new NotFoundException('Board não encontrado');
    if (board.project.ownerId !== userId) throw new ForbiddenException();
    return board;
  }
}

@Global()
@Module({ providers: [OwnershipService], exports: [OwnershipService] })
export class CommonModule {}
