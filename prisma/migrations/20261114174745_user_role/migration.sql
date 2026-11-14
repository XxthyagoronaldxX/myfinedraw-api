-- CreateEnum
CREATE TYPE "Role" AS ENUM ('user', 'superadmin');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "role" "Role" NOT NULL DEFAULT 'user';
