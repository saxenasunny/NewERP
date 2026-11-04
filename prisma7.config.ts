import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Next.js loads .env.local; the Prisma CLI does not, so load the same files
// explicitly. In deployed environments the variables come from the platform
// and these files are absent.
config({ path: [".env.local", ".env"], quiet: true });

// Generation does not connect to PostgreSQL. A placeholder keeps `prisma
// generate` (including postinstall) working on a fresh clone while still
// failing loudly on the first real database command.
const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: databaseUrl,
  },
});
