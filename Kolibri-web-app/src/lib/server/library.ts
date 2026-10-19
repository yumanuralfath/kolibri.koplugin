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

export function readLibrary(): Library {
	return {
		books: getBooks().map((book) => JSON.parse(book) as Book),
		readingSessions: getReadingSessions().map((session) => JSON.parse(session) as ReadingSession),
		published: getSetting('published') === 'true',
		publishId: getSetting('publishId')
	};
}

export function saveIncomingSessions(sessions: ReadingSession[]): void {
	saveReadingSessions(sessions);
}

export function updateLibrary(update: (library: Library) => void | Promise<void>): Library {
	const library = readLibrary();
	const result = update(library);
	if (result instanceof Promise) throw new Error('SQLite library updates must be synchronous.');
	saveBooks(library.books);
	setSetting('published', library.published ? 'true' : 'false');
	if (library.publishId) setSetting('publishId', library.publishId);
	else setSetting('publishId', '');
	return library;
}

export function safeBookId(value: string): string {
	return value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
}

export function getDeletedBooks(): Set<string> {
	return getDeletedBookIds();
}

export function deleteBook(bookId: string): { deletedSessions: number } {
	return deleteBookAndStats(bookId);
}
