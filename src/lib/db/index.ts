import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Single Prisma client per server process (survives dev hot reloads). Uses the pooled Neon URL. */
export function db(): PrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set.");
  const client = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });
  if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = client;
  return client;
}
