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
	/** true bila status diubah manual di web — sync/repair sesi tidak menimpa. */
	statusLocked?: boolean;
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

type LatestSession = { page: number; totalPages: number; startTime: number };

/** Sesi terakhir per buku (berdasarkan startTime), plus totalPages terbesar yang pernah terlihat. */
export function sessionProgressIndex(sessions: ReadingSession[]): {
	latestByBook: Map<string, LatestSession>;
	maxTotalByBook: Map<string, number>;
	firstByBook: Map<string, number>;
	lastEndByBook: Map<string, number>;
} {
	const latestByBook = new Map<string, LatestSession>();
	const maxTotalByBook = new Map<string, number>();
	const firstByBook = new Map<string, number>();
	const lastEndByBook = new Map<string, number>();
	for (const session of sessions) {
		if (!session.bookId || !Number.isFinite(session.startTime) || session.startTime <= 0) continue;
		const end = session.startTime + Math.max(0, session.duration || 0);
		const first = firstByBook.get(session.bookId);
		if (first === undefined || session.startTime < first) firstByBook.set(session.bookId, session.startTime);
		const last = lastEndByBook.get(session.bookId);
		if (last === undefined || end > last) lastEndByBook.set(session.bookId, end);
		const prev = latestByBook.get(session.bookId);
		if (!prev || session.startTime > prev.startTime) {
			latestByBook.set(session.bookId, {
				page: Math.max(0, session.page || 0),
				totalPages: Math.max(0, session.totalPages || 0),
				startTime: session.startTime
			});
		}
		if (session.totalPages > (maxTotalByBook.get(session.bookId) ?? 0)) {
			maxTotalByBook.set(session.bookId, session.totalPages);
		}
	}
	return { latestByBook, maxTotalByBook, firstByBook, lastEndByBook };
}

/** True bila page sesi terakhir sudah di (atau lewat) akhir buku. */
export function isNearBookEnd(page: number, totalPages: number): boolean {
	if (totalPages <= 0) return false;
	return page >= totalPages || page / totalPages >= 0.99;
}

/**
 * Samakan currentPage/progress dengan sesi terakhir.
 * - Belum finished → currentPage = page sesi terakhir (bukan metadata yang sering "nge-lock" ke totalPages).
 * - Finished → currentPage dikunci ke totalPages.
 * - Status finished hanya dipertahankan bila memang di akhir, atau dibuka lagi bila sesi terakhir masih di tengah.
 * @returns true jika ada field buku yang diubah.
 */
export function repairProgressFromSessions(books: Book[], sessions: ReadingSession[]): boolean {
	const { latestByBook, maxTotalByBook } = sessionProgressIndex(sessions);
	let repaired = false;
	for (const book of books) {
		const before = `${book.totalPages}|${book.currentPage}|${book.progress}|${book.status}|${book.finishedAt ?? ''}`;
		const latest = latestByBook.get(book.id);
		const sessionTotal = maxTotalByBook.get(book.id) ?? 0;

		if (latest) {
			// Pakai totalPages dari mode baca yang sama dengan sesi terakhir bila ada;
			// kalau metadata lebih besar tapi currentPage metadata "finished" palsu, sesi lebih akurat.
			const totalFromLatest = latest.totalPages > 0 ? latest.totalPages : sessionTotal;
			if (totalFromLatest > 0) {
				const metaLooksFinished =
					book.totalPages > 0 && book.currentPage >= book.totalPages && book.progress >= 100;
				const sessionStillReading = !isNearBookEnd(latest.page, totalFromLatest);
				if (
					sessionStillReading &&
					(metaLooksFinished || book.totalPages <= 0 || totalFromLatest < book.totalPages)
				) {
					book.totalPages = totalFromLatest;
				} else if (sessionTotal > book.totalPages) {
					book.totalPages = sessionTotal;
				}
			} else if (sessionTotal > book.totalPages) {
				book.totalPages = sessionTotal;
			}

			const atEnd = book.totalPages > 0 && isNearBookEnd(latest.page, book.totalPages);
			if (!book.statusLocked) {
				if (book.status === 'finished' && !atEnd) {
					// Tersalah-tandai selesai (mis. currentPage metadata = totalPages) padahal masih di tengah.
					book.status = 'reading';
					book.finishedAt = undefined;
				} else if (book.status !== 'finished' && book.status !== 'paused' && atEnd) {
					book.status = 'finished';
					if (!book.finishedAt) book.finishedAt = new Date(latest.startTime * 1000).toISOString();
				}
			}

			// Belum finished → page terakhir dari sesi. Sudah finished → kunci ke akhir.
			if (book.status === 'finished' && book.totalPages > 0) {
				book.currentPage = book.totalPages;
			} else {
				book.currentPage = latest.page;
			}
		} else if (sessionTotal > book.totalPages) {
			book.totalPages = sessionTotal;
		}

		if (book.totalPages > 0 && book.currentPage > book.totalPages) {
			book.totalPages = Math.max(book.totalPages, sessionTotal, book.currentPage);
		}
		if (book.totalPages > 0) {
			book.progress = Math.min(100, Math.round((book.currentPage / book.totalPages) * 100));
		}
		if (
			`${book.totalPages}|${book.currentPage}|${book.progress}|${book.status}|${book.finishedAt ?? ''}` !==
			before
		) {
			repaired = true;
		}
	}
	return repaired;
}

/**
 * Tanggal mulai & terakhir dibaca diturunkan dari sesi baca (seperti statistik KOReader):
 * mulai = sesi pertama, terakhir = akhir sesi terakhir. Buku tanpa sesi memakai nilai tersimpan.
 * Juga memperbaiki progress yang nyampur antar buku (mis. 577 / 38).
 * @returns true jika ada field buku yang diubah (perlu disimpan ulang).
 */
function applySessionDates(books: Book[], sessions: ReadingSession[]): boolean {
	const { firstByBook, lastEndByBook } = sessionProgressIndex(sessions);
	let repaired = false;
	for (const book of books) {
		const f = firstByBook.get(book.id);
		const l = lastEndByBook.get(book.id);
		if (f !== undefined) {
			const next = new Date(f * 1000).toISOString();
			if (book.startedAt !== next) {
				book.startedAt = next;
				repaired = true;
			}
		}
		if (l !== undefined) {
			const next = new Date(l * 1000).toISOString();
			if (book.lastReadAt !== next) {
				book.lastReadAt = next;
				repaired = true;
			}
		}
	}
	if (repairProgressFromSessions(books, sessions)) repaired = true;
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
