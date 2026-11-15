# ---------- build ----------
FROM node:22-slim AS build
# openssl é exigido pelo engine do Prisma
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate && npm run build

# ---------- runtime ----------
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4778 \
    UPLOAD_DIR=uploads

# node_modules completo: o CLI do Prisma (devDependency) roda as migrações no start
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
# Prisma 7: a URL de conexão das migrações vem do prisma.config.ts
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY package.json ./
RUN mkdir -p uploads

EXPOSE 4778
# aplica migrações pendentes e sobe a API
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
