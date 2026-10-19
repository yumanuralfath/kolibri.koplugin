import { json } from '@sveltejs/kit';
import { hasSyncPassword } from '../../../lib/server/auth';
import {
	saveIncomingSessions,
	updateLibrary,
	type Book,
	type Highlight,
	type ReadingSession
} from '../../../lib/server/library';
import type { RequestHandler } from './$types';

type SyncPayload = {
	book?: Partial<Book>;
	books?: Record<string, unknown>[];
	highlights?: Highlight[];
	stats?: Record<string, unknown>[];
};

// KOReader's JSON encoder serialises an empty Lua table as `{}` instead of `[]`,
// so every list from the plugin must be treated as untrusted.
function asArray<T>(value: unknown): T[] {
	return Array.isArray(value) ? (value as T[]) : [];
}

function cleanId(value: unknown): string {
	return String(value ?? '')
		.replace(/[^a-zA-Z0-9_-]/g, '')
		.slice(0, 120);
}

function parseAuthors(value: unknown): string[] {
	if (Array.isArray(value)) return value.map((author) => String(author).slice(0, 200)).slice(0, 20);
	if (typeof value === 'string') {
		return value
			.split(/[,;]/)
			.map((author) => author.trim().slice(0, 200))
			.filter(Boolean)
			.slice(0, 20);
	}
	return [];
}

function cleanHighlights(value: unknown): Highlight[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter((item): item is Highlight => Boolean(item && typeof item === 'object'))
		.map((item) => ({
			text: String(item.text ?? '').slice(0, 20_000),
			note: item.note ? String(item.note).slice(0, 10_000) : undefined,
			page: Number.isFinite(Number(item.page)) ? Number(item.page) : undefined,
			createdAt: item.createdAt ? String(item.createdAt) : undefined
		}))
		.filter((item) => item.text.length > 0);
}

export const POST: RequestHandler = async ({ request }) => {
	if (!hasSyncPassword(request)) return json({ error: 'Unauthorized.' }, { status: 401 });
	const payload = (await request.json().catch(() => null)) as SyncPayload | null;
	if (!payload || typeof payload !== 'object') {
		return json({ error: 'Invalid JSON body.' }, { status: 400 });
	}
	const incomingBooks = asArray<Record<string, unknown>>(payload.books);
	const incomingStats = asArray<Record<string, unknown>>(payload.stats);
	const source = payload.book;
	const id = cleanId(source?.id);
	const title = String(source?.title ?? '')
		.trim()
		.slice(0, 500);
	// A library-only sync (no book currently open) is valid as long as it carries data.
	const hasCurrentBook = Boolean(id && title);
	if (!hasCurrentBook && incomingBooks.length === 0 && incomingStats.length === 0) {
		return json({ error: 'Book id and title are required.' }, { status: 400 });
	}

	const currentPage = Math.max(0, Number(source?.currentPage) || 0);
	const now = new Date().toISOString();
	const incomingHighlights = cleanHighlights(payload?.highlights);
	const booksById = new Map<string, Record<string, unknown>>();
	const latestPageByBook = new Map<string, { page: number; startTime: number }>();
	for (const item of incomingBooks) {
		const bookId = cleanId(item.md5 ?? item.id);
		if (bookId) booksById.set(bookId, item);
	}
	for (const session of incomingStats) {
		const bookId = cleanId(session.book_md5 ?? session.bookId);
		const page = Number(session.page);
		const startTime = Number(session.start_time ?? session.startTime);
		const existing = latestPageByBook.get(bookId);
		if (
			bookId &&
			Number.isFinite(page) &&
			Number.isFinite(startTime) &&
			(!existing || startTime > existing.startTime)
		) {
			latestPageByBook.set(bookId, { page, startTime });
		}
	}
	if (source && hasCurrentBook) booksById.set(id, { ...booksById.get(id), ...source, id });

	const library = await updateLibrary((data) => {
		for (const [bookId, metadata] of booksById) {
			const existingIndex = data.books.findIndex((book) => book.id === bookId);
			const existing = existingIndex >= 0 ? data.books[existingIndex] : undefined;
			const isCurrentBook = bookId === id;
			const bookTotalPages = Math.max(0, Number(metadata.totalPages ?? metadata.pages) || 0);
			const bookCurrentPage = isCurrentBook
				? currentPage
				: Math.max(
						0,
						Number(metadata.currentPage ?? latestPageByBook.get(bookId)?.page) ||
							existing?.currentPage ||
							0
					);
			const bookProgress =
				bookTotalPages > 0
					? Math.min(100, Math.round((bookCurrentPage / bookTotalPages) * 100))
					: (existing?.progress ?? 0);
			const bookStatus: Book['status'] =
				bookProgress >= 100 ? 'finished' : existing?.status === 'paused' ? 'paused' : 'reading';
			const highlightMap = new Map<string, Highlight>();
			for (const highlight of [
				...(existing?.highlights ?? []),
				...(isCurrentBook ? incomingHighlights : [])
			]) {
				highlightMap.set(`${highlight.page ?? ''}:${highlight.text}`, highlight);
			}
			const book: Book = {
				id: bookId,
				title: String(
					metadata.title ?? existing?.title ?? (isCurrentBook ? title : 'Untitled')
				).slice(0, 500),
				authors: parseAuthors(metadata.authors ?? metadata.author).length
					? parseAuthors(metadata.authors ?? metadata.author)
					: (existing?.authors ?? []),
				series: metadata.series ? String(metadata.series).slice(0, 300) : existing?.series,
				language: metadata.language ? String(metadata.language).slice(0, 40) : existing?.language,
				totalPages: bookTotalPages || existing?.totalPages || 0,
				currentPage: bookCurrentPage,
				progress: bookProgress,
				totalReadPages: Math.max(
					0,
					Number(metadata.total_read_pages) || existing?.totalReadPages || 0
				),
				totalReadTime: Math.max(
					0,
					Number(metadata.total_read_time) || existing?.totalReadTime || 0
				),
				status: bookStatus,
				startedAt: existing?.startedAt ?? now,
				lastReadAt: metadata.last_open
					? new Date(Number(metadata.last_open) * 1000).toISOString()
					: (existing?.lastReadAt ?? now),
				finishedAt: bookStatus === 'finished' ? (existing?.finishedAt ?? now) : undefined,
				coverUrl: existing?.coverUrl,
				visible: existing?.visible ?? true,
				highlights: [...highlightMap.values()]
			};
			if (existingIndex >= 0) data.books[existingIndex] = book;
			else data.books.push(book);
		}
	});
	const sessions = incomingStats
		.map((entry): ReadingSession | null => {
			const bookId = cleanId(entry.book_md5 ?? entry.bookId);
			const page = Number(entry.page);
			const startTime = Number(entry.start_time ?? entry.startTime);
			const duration = Number(entry.duration);
			const sessionTotalPages = Number(entry.total_pages ?? entry.totalPages);
			if (!bookId || !Number.isFinite(startTime) || startTime <= 0) return null;
			const sessionId = `${bookId}:${page}:${startTime}`;
			return {
				id: sessionId,
				bookId,
				page: Math.max(0, Number.isFinite(page) ? page : 0),
				startTime,
				duration: Math.max(0, Number.isFinite(duration) ? duration : 0),
				totalPages: Math.max(0, Number.isFinite(sessionTotalPages) ? sessionTotalPages : 0)
			};
		})
		.filter((session): session is ReadingSession => session !== null);
	saveIncomingSessions(sessions);
	return json({
		ok: true,
		serverTime: now,
		received: true,
		books: library.books.length,
		importedBooks: booksById.size,
		importedSessions: sessions.length,
		highlights: incomingHighlights.length
	});
};
