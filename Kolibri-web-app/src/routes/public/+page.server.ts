import { readLibrary, type Book } from '../../lib/server/library';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const library = await readLibrary();

	// Hanya buku yang ditandai tampil di publik.
	const visibleBooks = library.books.filter((book: Book) => book.visible);
	const visibleIds = new Set(visibleBooks.map((book) => book.id));

	const books = visibleBooks.map((book: Book) => ({
		id: book.id,
		title: book.title,
		authors: book.authors,
		series: book.series,
		language: book.language,
		currentPage: book.currentPage,
		totalPages: book.totalPages,
		progress: book.progress,
		totalReadPages: book.totalReadPages,
		totalReadTime: book.totalReadTime,
		status: book.status,
		startedAt: book.startedAt,
		lastReadAt: book.lastReadAt,
		finishedAt: book.finishedAt,
		coverUrl: book.coverUrl,
		// Kutipan yang disembunyikan pemilik tidak pernah dikirim ke publik.
		highlights: (book.highlights ?? [])
			.filter((h) => h.visible !== false)
			.map((h) => ({ id: h.id, text: h.text, note: h.note, page: h.page, createdAt: h.createdAt }))
	}));

	return {
		published: library.published,
		displayName: library.displayName ?? '',
		books,
		// Sesi dari buku yang disembunyikan/tidak dipublikasikan tidak ikut dihitung.
		readingSessions: (library.readingSessions ?? []).filter((s) => visibleIds.has(s.bookId))
	};
};
