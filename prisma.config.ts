import { defineConfig } from "prisma/config";

// Prisma 7 does not load env files itself. Migrations use the direct (non-pooled) Neon URL.
try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local (CI, or env provided by the host)
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder" },
});
