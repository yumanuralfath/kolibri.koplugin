import { json } from '@sveltejs/kit';
import { hasSyncPassword } from '../../../lib/server/auth';
import {
	createHighlightId,
	getDeletedBooks,
	isPageBookmark,
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
	highlights?: unknown;
	stats?: Record<string, unknown>[];
};

// KOReader's JSON encoder serialises an empty Lua table as `{}` instead of `[]`,
// so every list from the plugin must be treated as untrusted.
function asArray<T>(value: unknown): T[] {
	if (Array.isArray(value)) return value as T[];
	if (value && typeof value === 'object') return Object.values(value) as T[];
	return [];
}

function cleanId(value: unknown): string {
	return String(value ?? '')
		.replace(/[^a-zA-Z0-9_-]/g, '')
		.slice(0, 120);
}

/** Prefer finite incoming numbers; never fall through on 0 via falsy `||`. */
function finiteNumber(value: unknown): number | undefined {
	const n = Number(value);
	return Number.isFinite(n) ? n : undefined;
}

/**
 * Fix books where progress bled across titles (e.g. currentPage 577 / totalPages 38)
 * by recomputing from reading sessions that belong to the same book id.
 */
function repairProgressFromSessions(books: Book[], sessions: ReadingSession[]): void {
	const latestPage = new Map<string, number>();
	const maxTotal = new Map<string, number>();
	for (const session of sessions) {
		if (!session.bookId) continue;
		if (session.page > (latestPage.get(session.bookId) ?? -1)) {
			latestPage.set(session.bookId, session.page);
		}
		if (session.totalPages > (maxTotal.get(session.bookId) ?? 0)) {
			maxTotal.set(session.bookId, session.totalPages);
		}
	}
	for (const book of books) {
		const sessionPages = maxTotal.get(book.id);
		if (sessionPages && sessionPages > book.totalPages) {
			book.totalPages = sessionPages;
		}
		const sessionCurrent = latestPage.get(book.id);
		if (sessionCurrent !== undefined && sessionCurrent > book.currentPage) {
			book.currentPage = sessionCurrent;
		}
		// If still inconsistent (page past end), trust the larger total from sessions.
		if (book.totalPages > 0 && book.currentPage > book.totalPages && sessionPages) {
			book.totalPages = Math.max(book.totalPages, sessionPages, book.currentPage);
		} else if (book.totalPages > 0 && book.currentPage > book.totalPages) {
			book.totalPages = book.currentPage;
		}
		if (book.totalPages > 0) {
			book.progress = Math.min(100, Math.round((book.currentPage / book.totalPages) * 100));
		}
	}
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

function cleanHighlights(value: unknown, bookId: string = ''): Highlight[] {
	if (!value || typeof value !== 'object') return [];
	const items = Array.isArray(value) ? value : Object.values(value);
	return items
		.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
		.map((item) => {
			const text = String(item.text ?? item.notes ?? '').slice(0, 20_000);
			const note = item.note ? String(item.note).slice(0, 10_000) : undefined;
			const page = Number.isFinite(Number(item.page ?? item.pageno))
				? Number(item.page ?? item.pageno)
				: undefined;
			const createdAt = item.createdAt || item.datetime ? String(item.createdAt || item.datetime) : undefined;
			const id = String(item.id || createHighlightId(bookId, text, page, createdAt));
			const visible = item.visible !== false;
			return {
				id,
				text,
				note,
				page,
				createdAt,
				visible
			};
		})
		.filter((item) => item.text.trim().length > 0 && !isPageBookmark(item.text));
}

export const POST: RequestHandler = async ({ request }) => {
	if (!(await hasSyncPassword(request))) return json({ error: 'Unauthorized.' }, { status: 401 });
	const payload = (await request.json().catch(() => null)) as SyncPayload | null;
	if (!payload || typeof payload !== 'object') {
		return json({ error: 'Invalid JSON body.' }, { status: 400 });
	}
	// Books deleted from the web app stay deleted: ignore them (and their stats/highlights) on every sync.
	const deletedIds = await getDeletedBooks();
	const rawBooks = asArray<Record<string, unknown>>(payload.books);
	const rawStats = asArray<Record<string, unknown>>(payload.stats);
	const incomingBooks = rawBooks.filter((item) => !deletedIds.has(cleanId(item.md5 ?? item.id)));
	const incomingStats = rawStats.filter(
		(item) => !deletedIds.has(cleanId(item.book_md5 ?? item.bookId))
	);
	const source = payload.book;
	const id = cleanId(source?.id);
	const currentBookDeleted = Boolean(id) && deletedIds.has(id);
	const incomingHighlights = currentBookDeleted
		? []
		: [...cleanHighlights(payload?.highlights), ...cleanHighlights(payload?.book?.highlights)];
	const title = String(source?.title ?? '')
		.trim()
		.slice(0, 500);

	// A library-only sync (no book currently open) is valid as long as it carries data.
	const hasCurrentBook = Boolean(id && title) && !currentBookDeleted;
	const hadDeletedData =
		currentBookDeleted ||
		rawBooks.length > incomingBooks.length ||
		rawStats.length > incomingStats.length;
	if (
		!hasCurrentBook &&
		hadDeletedData &&
		incomingBooks.length === 0 &&
		incomingStats.length === 0 &&
		incomingHighlights.length === 0
	) {
		return json({ ok: true, serverTime: new Date().toISOString(), received: true, skippedDeleted: true });
	}
	if (
		!hasCurrentBook &&
		incomingBooks.length === 0 &&
		incomingStats.length === 0 &&
		incomingHighlights.length === 0
	) {
		return json({ error: 'Book id and title are required.' }, { status: 400 });
	}

	const currentPage = Math.max(0, Number(source?.currentPage) || 0);
	const now = new Date().toISOString();
	const booksById = new Map<string, Record<string, unknown>>();
	const latestPageByBook = new Map<string, { page: number; startTime: number }>();
	const earliestSessionByBook = new Map<string, number>();
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
		if (bookId && Number.isFinite(startTime) && startTime > 0) {
			const curEarliest = earliestSessionByBook.get(bookId);
			if (!curEarliest || startTime < curEarliest) {
				earliestSessionByBook.set(bookId, startTime);
			}
		}
	}
	if (source && hasCurrentBook) booksById.set(id, { ...booksById.get(id), ...source, id });

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
	// Simpan sesi dulu: tanggal mulai/terakhir dibaca diturunkan dari sesi saat library dibaca.
	await saveIncomingSessions(sessions);

	// Max totalPages seen in sessions per book — heals rows where title-merge bled
	// a short book's page count onto a longer book's progress.
	const maxSessionPagesByBook = new Map<string, number>();
	for (const session of sessions) {
		if (session.totalPages > 0) {
			const prev = maxSessionPagesByBook.get(session.bookId) ?? 0;
			if (session.totalPages > prev) maxSessionPagesByBook.set(session.bookId, session.totalPages);
		}
	}

	let attachedHighlightsToAny = false;
	const library = await updateLibrary((data) => {
		for (const [bookId, metadata] of booksById) {
			// Identity is MD5/id only — never merge different files that share a metadata title
			// (e.g. "Kumpulan Cerpen" vs "Kumpulan Cerpen Kompas 2006").
			const existingIndex = data.books.findIndex((book) => book.id === bookId);
			const existing = existingIndex >= 0 ? data.books[existingIndex] : undefined;
			const isCurrentBook = bookId === id;
			if (isCurrentBook && incomingHighlights.length > 0) {
				attachedHighlightsToAny = true;
			}
			const metaTotal = finiteNumber(metadata.totalPages ?? metadata.pages);
			const sessionTotal = maxSessionPagesByBook.get(bookId) ?? 0;
			const bookTotalPages = Math.max(
				0,
				metaTotal !== undefined && metaTotal > 0 ? metaTotal : 0,
				sessionTotal,
				existing?.totalPages && existing.totalPages > 0 && (metaTotal === undefined || metaTotal <= 0)
					? existing.totalPages
					: 0
			);
			const latestFromSessions = latestPageByBook.get(bookId)?.page;
			const metaCurrent = finiteNumber(metadata.currentPage ?? latestFromSessions);
			const bookCurrentPage = isCurrentBook
				? currentPage
				: Math.max(
						0,
						metaCurrent !== undefined ? metaCurrent : (existing?.currentPage ?? 0)
					);
			const bookProgress =
				bookTotalPages > 0
					? Math.min(100, Math.round((bookCurrentPage / bookTotalPages) * 100))
					: (existing?.progress ?? 0);
			const incomingStatus =
				metadata.status === 'complete' || metadata.status === 'finished'
					? 'finished'
					: undefined;
			const bookStatus: Book['status'] =
				incomingStatus ??
				(bookProgress >= 100
					? 'finished'
					: existing?.status === 'finished'
						? 'finished'
						: existing?.status === 'paused'
							? 'paused'
							: 'reading');
			const bookHighlights = cleanHighlights(metadata.highlights, bookId);
			const highlightMap = new Map<string, Highlight>();
			for (const hl of existing?.highlights ?? []) {
				if (isPageBookmark(hl.text)) continue;
				const key = `${hl.page ?? ''}:${hl.text.trim()}`;
				highlightMap.set(key, hl);
			}
			for (const incoming of [...(isCurrentBook ? incomingHighlights : []), ...bookHighlights]) {
				if (isPageBookmark(incoming.text)) continue;
				const key = `${incoming.page ?? ''}:${incoming.text.trim()}`;
				const existingHl = highlightMap.get(key);
				if (existingHl) {
					highlightMap.set(key, {
						...incoming,
						id: existingHl.id,
						visible: existingHl.visible !== false,
						note: existingHl.note ?? incoming.note
					});
				} else {
					highlightMap.set(key, incoming);
				}
			}

			const earliestStart = earliestSessionByBook.get(bookId);
			let bookStartedAt = existing?.startedAt;
			if (earliestStart) {
				const sessionDate = new Date(earliestStart * 1000).toISOString();
				if (!bookStartedAt || new Date(sessionDate).getTime() < new Date(bookStartedAt).getTime()) {
					bookStartedAt = sessionDate;
				}
			}
			if (!bookStartedAt) bookStartedAt = now;

			let finishedAt = existing?.finishedAt;
			if (bookStatus === 'finished' && !finishedAt) {
				finishedAt = metadata.last_open
					? new Date(Number(metadata.last_open) * 1000).toISOString()
					: (existing?.lastReadAt ?? now);
			}

			const incomingReadPages = finiteNumber(metadata.total_read_pages);
			const incomingReadTime = finiteNumber(metadata.total_read_time);
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
				totalPages: bookTotalPages > 0 ? bookTotalPages : (existing?.totalPages ?? 0),
				currentPage: bookCurrentPage,
				progress: bookProgress,
				totalReadPages: Math.max(
					0,
					incomingReadPages !== undefined ? incomingReadPages : (existing?.totalReadPages ?? 0)
				),
				totalReadTime: Math.max(
					0,
					incomingReadTime !== undefined ? incomingReadTime : (existing?.totalReadTime ?? 0)
				),
				status: bookStatus,
				startedAt: bookStartedAt,
				lastReadAt: metadata.last_open
					? new Date(Number(metadata.last_open) * 1000).toISOString()
					: (existing?.lastReadAt ?? now),
				finishedAt,
				coverUrl: existing?.coverUrl,
				visible: existing?.visible ?? true,
				highlights: [...highlightMap.values()]
			};
			if (existingIndex >= 0) data.books[existingIndex] = book;
			else data.books.push(book);
		}

		// Heal any remaining inconsistent rows using session data already in the library.
		repairProgressFromSessions(data.books, data.readingSessions);

		data.books.sort((a, b) => new Date(b.lastReadAt).getTime() - new Date(a.lastReadAt).getTime());

		// Fallback: If incoming highlights were sent but not attached, attach to the most recently read book
		if (!attachedHighlightsToAny && incomingHighlights.length > 0 && data.books.length > 0) {
			const target = data.books[0];
			const highlightMap = new Map<string, Highlight>();
			for (const hl of target.highlights ?? []) {
				if (isPageBookmark(hl.text)) continue;
				const key = `${hl.page ?? ''}:${hl.text.trim()}`;
				highlightMap.set(key, hl);
			}
			for (const incoming of incomingHighlights) {
				if (isPageBookmark(incoming.text)) continue;
				const key = `${incoming.page ?? ''}:${incoming.text.trim()}`;
				const existingHl = highlightMap.get(key);
				if (existingHl) {
					highlightMap.set(key, {
						...incoming,
						id: existingHl.id,
						visible: existingHl.visible !== false,
						note: existingHl.note ?? incoming.note
					});
				} else {
					highlightMap.set(key, incoming);
				}
			}
			target.highlights = [...highlightMap.values()];
		}
	});
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
