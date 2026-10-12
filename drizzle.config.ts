import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/db/schema.ts", "./src/db/auth-schema.ts"],
  out: "./drizzle",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://aimthread:aimthread@localhost:5432/aimthread",
  },
  strict: true,
  verbose: true,
});
