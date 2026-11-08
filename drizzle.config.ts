// Postgres migrations (src/db/README.md): `npx drizzle-kit generate` writes
// SQL into drizzle/ from src/db/schema; src/db/migrate.ts applies it.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  casing: 'snake_case',
  strict: true
});
