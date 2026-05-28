import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Load .env.local first (local overrides)
config({ path: ".env.local" });

// Fallback to .env (default workspace config)
config();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "npx tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"] || "",
  },
});
