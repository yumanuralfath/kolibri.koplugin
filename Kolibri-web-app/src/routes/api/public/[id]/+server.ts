import { json } from '@sveltejs/kit';
import { readLibrary } from '../../../../lib/server/library';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const library = await readLibrary();
	if (!library.published || !library.publishId || params.id !== library.publishId) {
		return json({ error: 'Not found.' }, { status: 404 });
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
	return json({
		displayName: library.displayName ?? '',
		books
	});
};
