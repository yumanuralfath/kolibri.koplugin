import { readLibrary, type Book } from '../../lib/server/library';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const library = readLibrary();
	const books: Book[] = library.books
		.filter((book: Book) => book.visible)
		.map((book: Book) => ({
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
			visible: book.visible,
			highlights: (book.highlights ?? []).filter((h) => h.visible !== false)
		}));

	return {
		published: library.published,
		books,
		readingSessions: library.readingSessions ?? []
	};
};
