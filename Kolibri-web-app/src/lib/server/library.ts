import { createHash } from 'node:crypto';
import {
	deleteBookAndStats,
	getBooks,
	getDeletedBookIds,
	getReadingSessions,
	getSetting,
	saveBooks,
	saveReadingSessions,
	setSetting
} from './database';

export type Highlight = {
	id: string;
	text: string;
	note?: string;
	page?: number;
	createdAt?: string;
	visible: boolean;
};

export function isPageBookmark(text?: string): boolean {
	if (!text) return true;
	const trimmed = text.trim();
	if (!trimmed) return true;
	return (
		/^in \d+$/i.test(trimmed) ||
		/^in chapter/i.test(trimmed) ||
		/^🔖\s*bookmark/i.test(trimmed) ||
		/^bookmark\b/i.test(trimmed) ||
		/^page \d+/i.test(trimmed) ||
		/^hal(aman)?\s*\.?\s*\d+/i.test(trimmed)
	);
}

export function createHighlightId(
	bookId: string,
	text: string,
	page?: number,
	createdAt?: string
): string {
	const raw = `${bookId}:${page ?? ''}:${createdAt ?? ''}:${text.trim()}`;
	return createHash('sha1').update(raw).digest('hex').slice(0, 16);
}

export type ReadingSession = {
	id: string;
	bookId: string;
	page: number;
	startTime: number;
	duration: number;
	totalPages: number;
};

export type Book = {
	id: string;
	title: string;
	authors: string[];
	/** true bila judul diedit manual di web — sync KOReader tidak menimpa. */
	titleLocked?: boolean;
	/** true bila penulis diedit manual di web — sync KOReader tidak menimpa. */
	authorsLocked?: boolean;
	series?: string;
	language?: string;
	totalPages: number;
	currentPage: number;
	progress: number;
	totalReadPages?: number;
	totalReadTime?: number;
	status: 'reading' | 'finished' | 'paused';
	startedAt?: string;
	lastReadAt: string;
	finishedAt?: string;
	coverUrl?: string;
	visible: boolean;
	highlights: Highlight[];
};

export type Library = {
	books: Book[];
	readingSessions: ReadingSession[];
	published: boolean;
	publishId?: string;
	/** Nama pemilik untuk rak publik, mis. "{name} sedang membaca…" */
	displayName?: string;
};

/**
 * Tanggal mulai & terakhir dibaca diturunkan dari sesi baca (seperti statistik KOReader):
 * mulai = sesi pertama, terakhir = akhir sesi terakhir. Buku tanpa sesi memakai nilai tersimpan.
 * Juga memperbaiki progress yang nyampur antar buku (mis. 577 / 38).
 * @returns true jika ada field buku yang diubah (perlu disimpan ulang).
 */
function applySessionDates(books: Book[], sessions: ReadingSession[]): boolean {
	const first = new Map<string, number>();
	const last = new Map<string, number>();
	const latestPage = new Map<string, number>();
	const maxTotal = new Map<string, number>();
	for (const session of sessions) {
		if (!Number.isFinite(session.startTime) || session.startTime <= 0) continue;
		const end = session.startTime + Math.max(0, session.duration || 0);
		const f = first.get(session.bookId);
		if (f === undefined || session.startTime < f) first.set(session.bookId, session.startTime);
		const l = last.get(session.bookId);
		if (l === undefined || end > l) last.set(session.bookId, end);
		if (session.page > (latestPage.get(session.bookId) ?? -1)) {
			latestPage.set(session.bookId, session.page);
		}
		if (session.totalPages > (maxTotal.get(session.bookId) ?? 0)) {
			maxTotal.set(session.bookId, session.totalPages);
		}
	}
	let repaired = false;
	for (const book of books) {
		const f = first.get(book.id);
		const l = last.get(book.id);
		if (f !== undefined) book.startedAt = new Date(f * 1000).toISOString();
		if (l !== undefined) book.lastReadAt = new Date(l * 1000).toISOString();

		const before = `${book.totalPages}|${book.currentPage}|${book.progress}`;
		const sessionPages = maxTotal.get(book.id);
		if (sessionPages && sessionPages > book.totalPages) book.totalPages = sessionPages;
		const sessionCurrent = latestPage.get(book.id);
		if (sessionCurrent !== undefined && sessionCurrent > book.currentPage) {
			book.currentPage = sessionCurrent;
		}
		if (book.totalPages > 0 && book.currentPage > book.totalPages) {
			book.totalPages = Math.max(book.totalPages, sessionPages ?? 0, book.currentPage);
		}
		if (book.totalPages > 0) {
			book.progress = Math.min(100, Math.round((book.currentPage / book.totalPages) * 100));
		}
		if (`${book.totalPages}|${book.currentPage}|${book.progress}` !== before) repaired = true;
	}
	books.sort((a, b) => new Date(b.lastReadAt).getTime() - new Date(a.lastReadAt).getTime());
	return repaired;
}

export async function readLibrary(): Promise<Library> {
	const [bookRows, sessionRows, published, publishId, displayName] = await Promise.all([
		getBooks(),
		getReadingSessions(),
		getSetting('published'),
		getSetting('publishId'),
		getSetting('displayName')
	]);
	const books = bookRows.map((book) => JSON.parse(book) as Book);
	const readingSessions = sessionRows.map((session) => JSON.parse(session) as ReadingSession);
	const repaired = applySessionDates(books, readingSessions);
	if (repaired) {
		// Persist healed progress so "577 / 38" does not keep coming back from disk.
		await saveBooks(books);
	}
	return {
		books,
		readingSessions,
		published: published === 'true',
		publishId,
		displayName: displayName?.trim() || undefined
	};
}

export async function saveIncomingSessions(sessions: ReadingSession[]): Promise<void> {
	await saveReadingSessions(sessions);
}

export async function updateLibrary(
	update: (library: Library) => void | Promise<void>
): Promise<Library> {
	const library = await readLibrary();
	await update(library);
	await saveBooks(library.books);
	await setSetting('published', library.published ? 'true' : 'false');
	await setSetting('publishId', library.publishId ?? '');
	await setSetting('displayName', library.displayName?.trim() ?? '');
	return library;
}

export function safeBookId(value: string): string {
	return value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
}

export function getDeletedBooks(): Promise<Set<string>> {
	return getDeletedBookIds();
}

export function deleteBook(bookId: string): Promise<{ deletedSessions: number }> {
	return deleteBookAndStats(bookId);
}
