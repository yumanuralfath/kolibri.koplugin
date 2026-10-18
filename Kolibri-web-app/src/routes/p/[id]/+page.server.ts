import { error } from '@sveltejs/kit';
import { readLibrary } from '../../../lib/server/library';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const library = await readLibrary();
	if (!library.published || !library.publishId || params.id !== library.publishId) {
		throw error(404, 'This reading shelf is not available.');
	}
	const books = library.books
		.filter((book) => book.visible)
		.map((book) => ({
			id: book.id,
			title: book.title,
			authors: book.authors,
			currentPage: book.currentPage,
			totalPages: book.totalPages,
			progress: book.progress,
			status: book.status,
			coverUrl: book.coverUrl
		}));
	return { books };
};
