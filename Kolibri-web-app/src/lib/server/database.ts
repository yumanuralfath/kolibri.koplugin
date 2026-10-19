import { createHash } from 'node:crypto';
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
	CREATE TABLE IF NOT EXISTS reading_sessions (
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

function cleanBookmarksAndNormalizeDatabase(): void {
	if (settingExists('bookmarks_cleaned_v2')) return;
	try {
		const bookRows = database.prepare('SELECT id, data FROM books').all() as {
			id: string;
			data: string;
		}[];
		const sessionRows = database.prepare('SELECT data FROM reading_sessions').all() as {
			data: string;
		}[];

		const earliestSessionByBook = new Map<string, number>();
		for (const row of sessionRows) {
			try {
				const s = JSON.parse(row.data);
				if (s.bookId && Number.isFinite(s.startTime) && s.startTime > 0) {
					const cur = earliestSessionByBook.get(s.bookId);
					if (!cur || s.startTime < cur) earliestSessionByBook.set(s.bookId, s.startTime);
				}
			} catch {}
		}

		inTransaction(() => {
			const update = database.prepare('UPDATE books SET data = ? WHERE id = ?');
			for (const row of bookRows) {
				try {
					const book = JSON.parse(row.data);
					let changed = false;

					if (Array.isArray(book.highlights)) {
						const cleaned = [];
						for (const h of book.highlights) {
							const text = String(h.text ?? '').trim();
							if (!text) continue;
							const isBookmark =
								/^in \d+$/i.test(text) ||
								/^in chapter/i.test(text) ||
								/^🔖\s*bookmark/i.test(text) ||
								/^bookmark\b/i.test(text) ||
								/^page \d+/i.test(text) ||
								/^hal(aman)?\s*\.?\s*\d+/i.test(text);
							if (isBookmark) {
								changed = true;
								continue;
							}
							const id =
								h.id ||
								createHash('sha1')
									.update(`${book.id}:${h.page ?? ''}:${h.createdAt ?? ''}:${text}`)
									.digest('hex')
									.slice(0, 16);
							cleaned.push({
								...h,
								id,
								visible: h.visible !== false
							});
						}
						book.highlights = cleaned;
						changed = true;
					}

					const earliest = earliestSessionByBook.get(book.id);
					if (earliest) {
						const earliestIso = new Date(earliest * 1000).toISOString();
						if (!book.startedAt || new Date(earliestIso).getTime() < new Date(book.startedAt).getTime()) {
							book.startedAt = earliestIso;
							changed = true;
						}
					}

					if (book.status === 'finished' && !book.finishedAt) {
						book.finishedAt = book.lastReadAt || new Date().toISOString();
						changed = true;
					}

					if (changed) {
						update.run(JSON.stringify(book), row.id);
					}
				} catch {}
			}
			writeSetting('bookmarks_cleaned_v2', 'true');
		});
	} catch (e) {
		console.error('Migration cleanBookmarksAndNormalizeDatabase error:', e);
	}
}

migrateLegacyLibrary();
cleanBookmarksAndNormalizeDatabase();

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

export function getReadingSessions(): string[] {
	return (
		database.prepare('SELECT data FROM reading_sessions ORDER BY rowid ASC').all() as {
			data: string;
		}[]
	).map((row) => row.data);
}

export function saveReadingSessions(sessions: { id: string }[]): void {
	return inTransaction(() => {
		const insert = database.prepare(
			'INSERT INTO reading_sessions (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data'
		);
		for (const session of sessions) insert.run(session.id, JSON.stringify(session));
	});
}

export function saveBooks(books: { id: string }[]): void {
	return inTransaction(() => {
		database.exec('DELETE FROM books');
		const insert = database.prepare(
			'INSERT INTO books (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data'
		);
		const seen = new Set<string>();
		for (const book of books) {
			if (!book.id || seen.has(book.id)) continue;
			seen.add(book.id);
			insert.run(book.id, JSON.stringify(book));
		}
	});
}
