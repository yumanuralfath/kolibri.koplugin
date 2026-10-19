import { createClient, type Client, type InStatement } from '@libsql/client';
import { TURSO_AUTH_TOKEN, TURSO_DATABASE_URL } from '$app/env/private';

/**
 * Database: Turso (libSQL), dikonfigurasi lewat environment variable:
 *   TURSO_DATABASE_URL  mis. libsql://nama-db-org.turso.io  (atau file:local.db untuk dev lokal)
 *   TURSO_AUTH_TOKEN    token Turso (tidak wajib untuk file:)
 * Semua fungsi di sini async karena akses ke Turso lewat jaringan.
 */
let client: Client | undefined;
let schemaReady: Promise<void> | undefined;

function getClient(): Client {
	if (!client) {
		const url = TURSO_DATABASE_URL;
		if (!url) {
			throw new Error(
				'TURSO_DATABASE_URL belum diatur. Isi TURSO_DATABASE_URL dan TURSO_AUTH_TOKEN di environment.'
			);
		}
		client = createClient({ url, authToken: TURSO_AUTH_TOKEN || undefined });
	}
	return client;
}

async function db(): Promise<Client> {
	const c = getClient();
	schemaReady ??= c
		.batch(
			[
				'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
				'CREATE TABLE IF NOT EXISTS books (id TEXT PRIMARY KEY, data TEXT NOT NULL)',
				'CREATE TABLE IF NOT EXISTS reading_sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL)',
				'CREATE TABLE IF NOT EXISTS deleted_books (id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL)',
				'CREATE TABLE IF NOT EXISTS covers (name TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL)'
			],
			'write'
		)
		.then(() => undefined)
		.catch((error) => {
			schemaReady = undefined; // coba lagi pada request berikutnya
			throw error;
		});
	await schemaReady;
	return c;
}

const upsertSetting = (key: string, value: string): InStatement => ({
	sql: 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
	args: [key, value]
});

const CHUNK = 400;
async function batchInChunks(statements: InStatement[]): Promise<void> {
	const c = await db();
	for (let i = 0; i < statements.length; i += CHUNK) {
		await c.batch(statements.slice(i, i + CHUNK), 'write');
	}
}

export async function getSetting(key: string): Promise<string | undefined> {
	const result = await (await db()).execute({
		sql: 'SELECT value FROM settings WHERE key = ?',
		args: [key]
	});
	const value = result.rows[0]?.value;
	return value === undefined || value === null ? undefined : String(value);
}

export async function setSetting(key: string, value: string): Promise<void> {
	await (await db()).execute(upsertSetting(key, value));
}

export async function setSettings(settings: Record<string, string>): Promise<void> {
	await (await db()).batch(
		Object.entries(settings).map(([key, value]) => upsertSetting(key, value)),
		'write'
	);
}

/** Simpan pengaturan awal hanya jika password belum pernah dibuat (satu statement, atomik). */
export async function setInitialSettings(settings: Record<string, string>): Promise<boolean> {
	const entries = Object.entries(settings);
	if (entries.length === 0) return false;
	const rows = entries.map(() => 'SELECT ? AS k, ? AS v').join(' UNION ALL ');
	const result = await (await db()).execute({
		sql: `INSERT INTO settings (key, value)
			SELECT k, v FROM (${rows})
			WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key IN ('passwordHash', 'passwordSalt'))`,
		args: entries.flat()
	});
	return result.rowsAffected > 0;
}

export async function getBooks(): Promise<string[]> {
	const result = await (await db()).execute('SELECT data FROM books ORDER BY rowid ASC');
	return result.rows.map((row) => String(row.data));
}

export async function getReadingSessions(): Promise<string[]> {
	const result = await (await db()).execute('SELECT data FROM reading_sessions ORDER BY rowid ASC');
	return result.rows.map((row) => String(row.data));
}

export async function saveReadingSessions(sessions: { id: string }[]): Promise<void> {
	await batchInChunks(
		sessions.map((session) => ({
			sql: 'INSERT INTO reading_sessions (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data',
			args: [session.id, JSON.stringify(session)]
		}))
	);
}

/** Ganti seluruh isi tabel books (satu transaksi). */
export async function saveBooks(books: { id: string }[]): Promise<void> {
	const seen = new Set<string>();
	const statements: InStatement[] = ['DELETE FROM books'];
	for (const book of books) {
		if (!book.id || seen.has(book.id)) continue;
		seen.add(book.id);
		statements.push({
			sql: 'INSERT INTO books (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data',
			args: [book.id, JSON.stringify(book)]
		});
	}
	const c = await db();
	if (statements.length <= 1000) {
		await c.batch(statements, 'write');
	} else {
		// terlalu besar untuk satu batch: hapus lalu tulis bertahap
		await c.execute('DELETE FROM books');
		await batchInChunks(statements.slice(1));
	}
}

export async function getDeletedBookIds(): Promise<Set<string>> {
	const result = await (await db()).execute('SELECT id FROM deleted_books');
	return new Set(result.rows.map((row) => String(row.id)));
}

/**
 * Hapus buku secara permanen: baris buku, semua sesi baca (id `<bookId>:<page>:<startTime>`),
 * dan catat tombstone agar sync KOReader berikutnya tidak memunculkannya lagi.
 */
export async function deleteBookAndStats(bookId: string): Promise<{ deletedSessions: number }> {
	const prefix = `${bookId}:`;
	const results = await (await db()).batch(
		[
			{
				sql: 'DELETE FROM reading_sessions WHERE substr(id, 1, ?) = ?',
				args: [prefix.length, prefix]
			},
			{ sql: 'DELETE FROM books WHERE id = ?', args: [bookId] },
			{
				sql: 'INSERT INTO deleted_books (id, deleted_at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING',
				args: [bookId, new Date().toISOString()]
			}
		],
		'write'
	);
	return { deletedSessions: Number(results[0].rowsAffected) };
}

// ---- Sampul yang diupload (disimpan di database karena filesystem Vercel tidak persisten) ----

export async function saveCover(name: string, mime: string, data: Uint8Array): Promise<void> {
	await (await db()).execute({
		sql: 'INSERT INTO covers (name, mime, data) VALUES (?, ?, ?)',
		args: [name, mime, data]
	});
}

export async function getCover(name: string): Promise<{ mime: string; data: Uint8Array } | null> {
	const result = await (await db()).execute({
		sql: 'SELECT mime, data FROM covers WHERE name = ?',
		args: [name]
	});
	const row = result.rows[0];
	if (!row) return null;
	const raw = row.data as unknown;
	const data = raw instanceof Uint8Array ? raw : new Uint8Array(raw as ArrayBuffer);
	return { mime: String(row.mime), data };
}

export async function deleteCover(name: string): Promise<void> {
	await (await db()).execute({ sql: 'DELETE FROM covers WHERE name = ?', args: [name] });
}
