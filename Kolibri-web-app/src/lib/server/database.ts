import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const databasePath = join(process.cwd(), 'data', 'kolibri.sqlite');
mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
chmodSync(dirname(databasePath), 0o700);

export const database = new DatabaseSync(databasePath);
chmodSync(databasePath, 0o600);
database.exec(`
	PRAGMA journal_mode = WAL;
	PRAGMA foreign_keys = ON;
	CREATE TABLE IF NOT EXISTS settings (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL
	);
	CREATE TABLE IF NOT EXISTS books (
		id TEXT PRIMARY KEY,
		data TEXT NOT NULL
	);
`);

function settingExists(key: string): boolean {
	return Boolean(database.prepare('SELECT 1 FROM settings WHERE key = ?').get(key));
}

function writeSetting(key: string, value: string): void {
	database
		.prepare(
			'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
		)
		.run(key, value);
}

function inTransaction<T>(operation: () => T): T {
	database.exec('BEGIN IMMEDIATE');
	try {
		const result = operation();
		database.exec('COMMIT');
		return result;
	} catch (error) {
		database.exec('ROLLBACK');
		throw error;
	}
}

function migrateLegacyLibrary(): void {
	if (settingExists('legacy_library_imported')) return;
	const legacyPath = join(process.cwd(), 'data', 'library.json');
	if (existsSync(legacyPath)) {
		try {
			const legacy = JSON.parse(readFileSync(legacyPath, 'utf8')) as {
				books?: { id: string }[];
				published?: boolean;
				publishId?: string;
			};
			inTransaction(() => {
				const insert = database.prepare('INSERT OR REPLACE INTO books (id, data) VALUES (?, ?)');
				for (const book of legacy.books ?? []) insert.run(book.id, JSON.stringify(book));
				writeSetting('published', legacy.published ? 'true' : 'false');
				if (legacy.publishId) writeSetting('publishId', legacy.publishId);
				writeSetting('legacy_library_imported', 'true');
			});
			return;
		} catch {
			// Keep the original file intact when it cannot be imported.
		}
	}
	writeSetting('legacy_library_imported', 'true');
}

migrateLegacyLibrary();

export function getSetting(key: string): string | undefined {
	const row = database.prepare('SELECT value FROM settings WHERE key = ?').get(key) as {
		value: string;
	} | null;
	return row?.value;
}

export function setSetting(key: string, value: string): void {
	writeSetting(key, value);
}

export function setSettings(settings: Record<string, string>): void {
	return inTransaction(() => {
		for (const [key, value] of Object.entries(settings)) writeSetting(key, value);
	});
}

export function setInitialSettings(settings: Record<string, string>): boolean {
	return inTransaction(() => {
		if (settingExists('passwordHash') || settingExists('passwordSalt')) return false;
		for (const [key, value] of Object.entries(settings)) writeSetting(key, value);
		return true;
	});
}

export function getBooks(): string[] {
	return (
		database.prepare('SELECT data FROM books ORDER BY rowid ASC').all() as { data: string }[]
	).map((row) => row.data);
}

export function saveBooks(books: { id: string }[]): void {
	return inTransaction(() => {
		database.exec('DELETE FROM books');
		const insert = database.prepare('INSERT INTO books (id, data) VALUES (?, ?)');
		for (const book of books) insert.run(book.id, JSON.stringify(book));
	});
}
