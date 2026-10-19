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
};

/**
 * Tanggal mulai & terakhir dibaca diturunkan dari sesi baca (seperti statistik KOReader):
 * mulai = sesi pertama, terakhir = akhir sesi terakhir. Buku tanpa sesi memakai nilai tersimpan.
 */
function applySessionDates(books: Book[], sessions: ReadingSession[]): void {
	const first = new Map<string, number>();
	const last = new Map<string, number>();
	for (const session of sessions) {
		if (!Number.isFinite(session.startTime) || session.startTime <= 0) continue;
		const end = session.startTime + Math.max(0, session.duration || 0);
		const f = first.get(session.bookId);
		if (f === undefined || session.startTime < f) first.set(session.bookId, session.startTime);
		const l = last.get(session.bookId);
		if (l === undefined || end > l) last.set(session.bookId, end);
	}
	for (const book of books) {
		const f = first.get(book.id);
		const l = last.get(book.id);
		if (f !== undefined) book.startedAt = new Date(f * 1000).toISOString();
		if (l !== undefined) book.lastReadAt = new Date(l * 1000).toISOString();
	}
	books.sort((a, b) => new Date(b.lastReadAt).getTime() - new Date(a.lastReadAt).getTime());
}

export async function readLibrary(): Promise<Library> {
	const [bookRows, sessionRows, published, publishId] = await Promise.all([
		getBooks(),
		getReadingSessions(),
		getSetting('published'),
		getSetting('publishId')
	]);
	const books = bookRows.map((book) => JSON.parse(book) as Book);
	const readingSessions = sessionRows.map((session) => JSON.parse(session) as ReadingSession);
	applySessionDates(books, readingSessions);
	return { books, readingSessions, published: published === 'true', publishId };
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
