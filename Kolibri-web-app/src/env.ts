import { defineEnvVars } from '@sveltejs/kit/env';

// SvelteKit 3: variabel environment harus dideklarasikan di sini.
// Nilainya dibaca dari .env (dev) atau environment Vercel (produksi).
export const variables = defineEnvVars({
	TURSO_DATABASE_URL: {
		schema: (value) => value ?? ''
	},
	TURSO_AUTH_TOKEN: {
		schema: (value) => value ?? ''
	}
});
