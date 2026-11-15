// Configuração do Prisma CLI (migrate, generate, studio) — Prisma 7+.
// O Prisma 7 não carrega o .env sozinho: o dotenv/config faz isso aqui.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // process.env (e não env()) para o `prisma generate` funcionar sem banco, ex.: no `docker build`.
  // migrate/studio precisam da DATABASE_URL definida (no .env ou no ambiente).
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
