import { json } from '@sveltejs/kit';
import { hasSyncPassword } from '../../../lib/server/auth';
import { updateLibrary, type Book, type Highlight } from '../../../lib/server/library';
import type { RequestHandler } from './$types';

type SyncPayload = {
	book?: Partial<Book>;
	highlights?: Highlight[];
};

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
	const source = payload?.book;
	const id = String(source?.id ?? '')
		.replace(/[^a-zA-Z0-9_-]/g, '')
		.slice(0, 120);
	const title = String(source?.title ?? '')
		.trim()
		.slice(0, 500);
	if (!id || !title) return json({ error: 'Book id and title are required.' }, { status: 400 });

	const totalPages = Math.max(0, Number(source?.totalPages) || 0);
	const currentPage = Math.max(0, Number(source?.currentPage) || 0);
	const progress =
		totalPages > 0
			? Math.min(100, Math.round((currentPage / totalPages) * 100))
			: Math.min(100, Math.max(0, Number(source?.progress) || 0));
	const now = new Date().toISOString();
	const status: Book['status'] =
		progress >= 100 ? 'finished' : source?.status === 'paused' ? 'paused' : 'reading';
	const incomingHighlights = cleanHighlights(payload?.highlights);

	const library = await updateLibrary((data) => {
		const existingIndex = data.books.findIndex((book) => book.id === id);
		const existing = existingIndex >= 0 ? data.books[existingIndex] : undefined;
		const highlightMap = new Map<string, Highlight>();
		for (const highlight of [...(existing?.highlights ?? []), ...incomingHighlights]) {
			highlightMap.set(`${highlight.page ?? ''}:${highlight.text}`, highlight);
		}
		const book: Book = {
			id,
			title,
			authors: Array.isArray(source?.authors)
				? source.authors.map((author) => String(author).slice(0, 200)).slice(0, 20)
				: (existing?.authors ?? []),
			series: source?.series ? String(source.series).slice(0, 300) : existing?.series,
			language: source?.language ? String(source.language).slice(0, 40) : existing?.language,
			totalPages: totalPages || existing?.totalPages || 0,
			currentPage: currentPage || existing?.currentPage || 0,
			progress: totalPages || source?.progress !== undefined ? progress : (existing?.progress ?? 0),
			status: totalPages || source?.progress !== undefined ? status : (existing?.status ?? status),
			startedAt: existing?.startedAt ?? now,
			lastReadAt: now,
			finishedAt: status === 'finished' ? (existing?.finishedAt ?? now) : undefined,
			coverUrl: existing?.coverUrl,
			visible: existing?.visible ?? true,
			highlights: [...highlightMap.values()]
		};
		if (existingIndex >= 0) data.books[existingIndex] = book;
		else data.books.unshift(book);
	});
	return json({ received: true, books: library.books.length });
};
