import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { parse } from 'dotenv';
import { FSWatcher, readFileSync, watch } from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.module';

const ENV_FILE = join(process.cwd(), '.env');
const KEYS = ['SUPERADMIN_NAME', 'SUPERADMIN_EMAIL', 'SUPERADMIN_PASSWORD'] as const;

/**
 * Mantém a conta superadmin em sincronia com o .env:
 * - ao iniciar a API, cria ou atualiza a conta;
 * - enquanto a API roda, observa o .env e reaplica a cada alteração (sem reiniciar).
 */
@Injectable()
export class SuperadminService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('Superadmin');
  private watcher?: FSWatcher;
  private timer?: NodeJS.Timeout;

  constructor(private prisma: PrismaService) {}

  async onApplicationBootstrap() {
    await this.sync();
    try {
      this.watcher = watch(ENV_FILE, () => {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.reloadFromFile(), 300);
      });
    } catch {
      this.log.warn('.env não encontrado; alterações não serão observadas.');
    }
  }

  onApplicationShutdown() {
    this.watcher?.close();
    clearTimeout(this.timer);
  }

  private async reloadFromFile() {
    try {
      const env = parse(readFileSync(ENV_FILE));
      for (const k of KEYS) {
        if (env[k] !== undefined) process.env[k] = env[k];
        else delete process.env[k];
      }
      await this.sync();
    } catch (e) {
      this.log.error(`Falha ao recarregar .env: ${(e as Error).message}`);
    }
  }

  async sync() {
    const email = process.env.SUPERADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.SUPERADMIN_PASSWORD;
    const name = process.env.SUPERADMIN_NAME?.trim() || 'Super Admin';
    if (!email || !password) {
      this.log.warn('SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD não definidos; superadmin não sincronizado.');
      return;
    }
    if (password.length < 6) {
      this.log.warn('SUPERADMIN_PASSWORD precisa de pelo menos 6 caracteres.');
      return;
    }

    const current = await this.prisma.user.findFirst({ where: { role: 'superadmin' }, orderBy: { createdAt: 'asc' } });
    const byEmail = await this.prisma.user.findUnique({ where: { email } });
    // Se o e-mail novo já pertence a outra conta, ela passa a ser a superadmin.
    const target = byEmail ?? current;

    if (!target) {
      await this.prisma.user.create({
        data: { name, email, role: 'superadmin', passwordHash: await bcrypt.hash(password, 10) },
      });
      this.log.log(`Superadmin criado: ${email}`);
      return;
    }

    if (current && current.id !== target.id) {
      await this.prisma.user.update({ where: { id: current.id }, data: { role: 'user' } });
      this.log.log(`Conta ${current.email} deixou de ser superadmin.`);
    }

    const samePassword = await bcrypt.compare(password, target.passwordHash);
    const changed = target.email !== email || target.name !== name || target.role !== 'superadmin' || !samePassword;
    if (!changed) return;

    await this.prisma.user.update({
      where: { id: target.id },
      data: {
        email,
        name,
        role: 'superadmin',
        ...(samePassword ? {} : { passwordHash: await bcrypt.hash(password, 10) }),
      },
    });
    this.log.log(`Superadmin atualizado: ${email}`);
  }
}
