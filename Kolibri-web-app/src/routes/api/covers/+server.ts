import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const query = url.searchParams.get('q')?.trim();
	if (!query) return json({ covers: [] });
	try {
		const response = await fetch(
			`https://openlibrary.org/search.json?title=${encodeURIComponent(query)}&limit=6&fields=title,author_name,cover_i`
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
