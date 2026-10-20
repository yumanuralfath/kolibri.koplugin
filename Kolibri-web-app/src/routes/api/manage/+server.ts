import { json } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { isAuthenticated } from '../../../lib/server/auth';
import { removeUploadedCover } from '../../../lib/server/covers';
import { deleteBook, readLibrary, safeBookId, updateLibrary } from '../../../lib/server/library';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => {
	if (!(await isAuthenticated(request))) return json({ error: 'Unauthorized.' }, { status: 401 });
	return json(await readLibrary());
};

export const DELETE: RequestHandler = async ({ request }) => {
	if (!(await isAuthenticated(request))) return json({ error: 'Unauthorized.' }, { status: 401 });
	const body = (await request.json().catch(() => null)) as { bookId?: string } | null;
	const bookId = safeBookId(String(body?.bookId ?? ''));
	if (!bookId) return json({ error: 'Book id is required.' }, { status: 400 });
	const existing = (await readLibrary()).books.find((book) => book.id === bookId);
	if (!existing) return json({ error: 'Book not found.' }, { status: 404 });
	await removeUploadedCover(existing.coverUrl);
	await deleteBook(bookId);
	return json(await readLibrary());
};

export const PATCH: RequestHandler = async ({ request }) => {
	if (!(await isAuthenticated(request))) return json({ error: 'Unauthorized.' }, { status: 401 });
	const body = (await request.json().catch(() => null)) as {
		bookId?: string;
		visible?: boolean;
		coverUrl?: string | null;
		title?: string;
		authors?: string | string[];
		published?: boolean;
		displayName?: string | null;
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
	let staleCover: string | undefined;
	const library = await updateLibrary((data) => {
		if (typeof body.published === 'boolean') {
			data.published = body.published;
			if (body.published && !data.publishId) data.publishId = randomUUID().replaceAll('-', '');
		}
		if (body.displayName !== undefined) {
			const name = body.displayName == null ? '' : String(body.displayName).trim().slice(0, 80);
			data.displayName = name || undefined;
		}
		if (body.bookId) {
			const book = data.books.find((item) => item.id === body.bookId);
			if (book) {
				if (typeof body.visible === 'boolean') book.visible = body.visible;
				if (body.coverUrl !== undefined) {
					const nextCover = body.coverUrl ? String(body.coverUrl).slice(0, 2000) : undefined;
					if (book.coverUrl !== nextCover) staleCover = book.coverUrl;
					book.coverUrl = body.coverUrl ? String(body.coverUrl).slice(0, 2000) : undefined;
				}
				if (body.title !== undefined) {
					const title = String(body.title).trim().slice(0, 500);
					if (title) {
						book.title = title;
						book.titleLocked = true;
					}
				}
				if (body.authors !== undefined) {
					const list = Array.isArray(body.authors)
						? body.authors
						: String(body.authors)
								.split(/[,;]/)
								.map((a) => a.trim())
								.filter(Boolean);
					book.authors = list.map((a) => String(a).slice(0, 200)).slice(0, 20);
					book.authorsLocked = true;
				}
				if (body.startedAt) book.startedAt = String(body.startedAt);
				if (body.finishedAt !== undefined) book.finishedAt = body.finishedAt ? String(body.finishedAt) : undefined;
				if (body.status && ['reading', 'finished', 'paused'].includes(body.status)) {
					book.status = body.status;
					book.statusLocked = true;
					if (body.status === 'finished') {
						// ditandai selesai secara manual: catat tanggal tamat bila belum ada
						if (body.finishedAt === undefined && !book.finishedAt) book.finishedAt = new Date().toISOString();
						if (book.totalPages > 0) book.currentPage = book.totalPages;
						if (book.totalPages > 0) {
							book.progress = Math.min(100, Math.round((book.currentPage / book.totalPages) * 100));
						}
					} else if (body.finishedAt === undefined) {
						// dibatalkan: hapus tanggal tamat
						book.finishedAt = undefined;
					}
				}

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
	await removeUploadedCover(staleCover);
	return json(library);
};
