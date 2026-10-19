import { json } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { isAuthenticated } from '../../../lib/server/auth';
import { deleteBook, readLibrary, safeBookId, updateLibrary } from '../../../lib/server/library';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => {
	if (!isAuthenticated(request)) return json({ error: 'Unauthorized.' }, { status: 401 });
	return json(readLibrary());
};

export const DELETE: RequestHandler = async ({ request }) => {
	if (!isAuthenticated(request)) return json({ error: 'Unauthorized.' }, { status: 401 });
	const body = (await request.json().catch(() => null)) as { bookId?: string } | null;
	const bookId = safeBookId(String(body?.bookId ?? ''));
	if (!bookId) return json({ error: 'Book id is required.' }, { status: 400 });
	if (!readLibrary().books.some((book) => book.id === bookId)) {
		return json({ error: 'Book not found.' }, { status: 404 });
	}
	deleteBook(bookId);
	return json(readLibrary());
};

export const PATCH: RequestHandler = async ({ request }) => {
	if (!isAuthenticated(request)) return json({ error: 'Unauthorized.' }, { status: 401 });
	const body = (await request.json().catch(() => null)) as {
		bookId?: string;
		visible?: boolean;
		coverUrl?: string | null;
		published?: boolean;
		startedAt?: string;
		finishedAt?: string;
		status?: 'reading' | 'finished' | 'paused';
		highlightId?: string;
		highlight?: {
			visible?: boolean;
			note?: string;
			text?: string;
		};
		setAllHighlightsVisible?: boolean;
		deleteHighlightId?: string;
	} | null;
	if (!body) return json({ error: 'Invalid request.' }, { status: 400 });
	const library = updateLibrary((data) => {
		if (typeof body.published === 'boolean') {
			data.published = body.published;
			if (body.published && !data.publishId) data.publishId = randomUUID().replaceAll('-', '');
		}
		if (body.bookId) {
			const book = data.books.find((item) => item.id === body.bookId);
			if (book) {
				if (typeof body.visible === 'boolean') book.visible = body.visible;
				if (body.coverUrl !== undefined) {
					book.coverUrl = body.coverUrl ? String(body.coverUrl).slice(0, 2000) : undefined;
				}
				if (body.startedAt) book.startedAt = String(body.startedAt);
				if (body.finishedAt !== undefined) book.finishedAt = body.finishedAt ? String(body.finishedAt) : undefined;
				if (body.status) book.status = body.status;

				if (body.highlightId && body.highlight) {
					const hl = book.highlights?.find((h) => h.id === body.highlightId);
					if (hl) {
						if (body.highlight.visible !== undefined) hl.visible = Boolean(body.highlight.visible);
						if (body.highlight.note !== undefined) {
							hl.note = body.highlight.note ? String(body.highlight.note).slice(0, 10_000) : undefined;
						}
						if (body.highlight.text !== undefined) {
							hl.text = String(body.highlight.text).slice(0, 20_000);
						}
					}
				}

				if (typeof body.setAllHighlightsVisible === 'boolean') {
					for (const hl of book.highlights ?? []) {
						hl.visible = body.setAllHighlightsVisible;
					}
				}

				if (body.deleteHighlightId) {
					book.highlights = (book.highlights ?? []).filter((h) => h.id !== body.deleteHighlightId);
				}
			}
		}
	});
	return json(library);
};
