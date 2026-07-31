import type { Config } from 'drizzle-kit';

export default {
  dialect: 'postgresql',
  schema: './src/server/schema.ts',
  out: './src/server/migrations',
} satisfies Config;
