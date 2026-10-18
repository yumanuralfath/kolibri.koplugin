import { json } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { isAuthenticated } from '../../../lib/server/auth';
import { readLibrary, updateLibrary } from '../../../lib/server/library';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => {
	if (!isAuthenticated(request)) return json({ error: 'Unauthorized.' }, { status: 401 });
	return json(readLibrary());
};

export const PATCH: RequestHandler = async ({ request }) => {
	if (!isAuthenticated(request)) return json({ error: 'Unauthorized.' }, { status: 401 });
	const body = (await request.json().catch(() => null)) as {
		bookId?: string;
		visible?: boolean;
		coverUrl?: string | null;
		published?: boolean;
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
			}
		}
	});
	return json(library);
};
