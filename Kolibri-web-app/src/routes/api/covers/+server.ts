import { json } from '@sveltejs/kit';
import { isAuthenticated } from '../../../lib/server/auth';
import { readLibrary, updateLibrary } from '../../../lib/server/library';
import type { RequestHandler } from './$types';

function cleanSearchQuery(title: string): string {
	return title
		.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
		.replace(/\b(vol|volume|chapter|ch|file|duel|jilid)\b.*$/i, ' ')
		.replace(/[-_:]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export const GET: RequestHandler = async ({ url }) => {
	const query = url.searchParams.get('q')?.trim();
	if (!query) return json({ covers: [] });
	try {
		const cleaned = cleanSearchQuery(query) || query;
		const response = await fetch(
			`https://openlibrary.org/search.json?title=${encodeURIComponent(cleaned)}&limit=6&fields=title,author_name,cover_i`
		);
		if (!response.ok) return json({ covers: [] }, { status: 502 });
		const result = (await response.json()) as {
			docs?: { title?: string; author_name?: string[]; cover_i?: number }[];
		};
		const covers = (result.docs ?? [])
			.filter((book) => book.cover_i)
			.map((book) => ({
				title: book.title ?? query,
				author: book.author_name?.[0] ?? '',
				url: `https://covers.openlibrary.org/b/id/${book.cover_i}-M.jpg`
			}));
		return json({ covers });
	} catch {
		return json({ covers: [] }, { status: 502 });
	}
};

export const POST: RequestHandler = async ({ request }) => {
	if (!isAuthenticated(request)) return json({ error: 'Unauthorized.' }, { status: 401 });
	const body = (await request.json().catch(() => ({}))) as { overwriteAll?: boolean };
	const library = readLibrary();
	const targetBooks = library.books.filter((b) => body.overwriteAll || !b.coverUrl);

	if (targetBooks.length === 0) {
		return json({ ok: true, updatedCount: 0, library });
	}

	const updatedCovers = new Map<string, string>();

	for (const book of targetBooks) {
		const cleaned = cleanSearchQuery(book.title) || book.title;
		try {
			const res = await fetch(
				`https://openlibrary.org/search.json?title=${encodeURIComponent(cleaned)}&limit=3&fields=title,cover_i`,
				{ signal: AbortSignal.timeout(6000) }
			);
			if (res.ok) {
				const data = (await res.json()) as { docs?: { cover_i?: number }[] };
				const coverDoc = data.docs?.find((d) => d.cover_i);
				if (coverDoc?.cover_i) {
					updatedCovers.set(
						book.id,
						`https://covers.openlibrary.org/b/id/${coverDoc.cover_i}-M.jpg`
					);
				}
			}
		} catch {
			// Ignore individual timeouts/network errors
		}
	}

	if (updatedCovers.size > 0) {
		updateLibrary((data) => {
			for (const book of data.books) {
				const newCover = updatedCovers.get(book.id);
				if (newCover) {
					book.coverUrl = newCover;
				}
			}
		});
	}

	return json({
		ok: true,
		updatedCount: updatedCovers.size,
		totalChecked: targetBooks.length,
		library: readLibrary()
	});
};
