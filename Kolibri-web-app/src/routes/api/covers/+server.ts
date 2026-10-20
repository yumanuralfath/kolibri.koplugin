import { GOOGLE_BOOKS_API_KEY } from '$app/env/private';
import { json } from '@sveltejs/kit';
import { isAuthenticated } from '../../../lib/server/auth';
import { readLibrary, updateLibrary } from '../../../lib/server/library';
import type { RequestHandler } from './$types';

type CoverResult = {
	title: string;
	author: string;
	url: string;
	source: 'openlibrary' | 'googlebooks';
};

function cleanSearchQuery(title: string): string {
	return title
		.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
		.replace(/\b(vol|volume|chapter|ch|file|duel|jilid)\b.*$/i, ' ')
		.replace(/[-_:]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function httpsUrl(url: string): string {
	return url.replace(/^http:\/\//i, 'https://');
}

function dedupeCovers(covers: CoverResult[]): CoverResult[] {
	const seen = new Set<string>();
	const out: CoverResult[] = [];
	for (const cover of covers) {
		const key = cover.url.replace(/\?.*/, '').toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(cover);
	}
	return out;
}

async function searchOpenLibrary(query: string, limit = 6): Promise<CoverResult[]> {
	try {
		const response = await fetch(
			`https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=${limit}&fields=title,author_name,cover_i`,
			{ signal: AbortSignal.timeout(8000) }
		);
		if (!response.ok) return [];
		const result = (await response.json()) as {
			docs?: { title?: string; author_name?: string[]; cover_i?: number }[];
		};
		return (result.docs ?? [])
			.filter((book) => book.cover_i)
			.map((book) => ({
				title: book.title ?? query,
				author: book.author_name?.[0] ?? '',
				url: `https://covers.openlibrary.org/b/id/${book.cover_i}-L.jpg`,
				source: 'openlibrary' as const
			}));
	} catch {
		return [];
	}
}

async function searchGoogleBooks(query: string, limit = 6): Promise<CoverResult[]> {
	try {
		const params = new URLSearchParams({
			q: query,
			maxResults: String(limit),
			printType: 'books',
			fields: 'items(volumeInfo/title,volumeInfo/authors,volumeInfo/imageLinks)'
		});
		const apiKey = GOOGLE_BOOKS_API_KEY?.trim();
		if (apiKey) params.set('key', apiKey);
		const response = await fetch(`https://www.googleapis.com/books/v1/volumes?${params}`, {
			signal: AbortSignal.timeout(8000)
		});
		if (!response.ok) return [];
		const result = (await response.json()) as {
			items?: {
				volumeInfo?: {
					title?: string;
					authors?: string[];
					imageLinks?: {
						thumbnail?: string;
						small?: string;
						medium?: string;
						large?: string;
						extraLarge?: string;
					};
				};
			}[];
		};
		const covers: CoverResult[] = [];
		for (const item of result.items ?? []) {
			const info = item.volumeInfo;
			const links = info?.imageLinks;
			const raw =
				links?.extraLarge ||
				links?.large ||
				links?.medium ||
				links?.small ||
				links?.thumbnail;
			if (!raw || !info?.title) continue;
			const url = httpsUrl(raw)
				.replace(/&edge=curl/gi, '')
				.replace(/zoom=\d+/i, 'zoom=1');
			covers.push({
				title: info.title,
				author: info.authors?.[0] ?? '',
				url,
				source: 'googlebooks'
			});
		}
		return covers;
	} catch {
		return [];
	}
}

/** Cari sampul dari Open Library + Google Books, digabung & di-dedupe. */
async function searchCovers(query: string, limitPerSource = 6): Promise<CoverResult[]> {
	const cleaned = cleanSearchQuery(query) || query;
	const [openLibrary, googleBooks] = await Promise.all([
		searchOpenLibrary(cleaned, limitPerSource),
		searchGoogleBooks(cleaned, limitPerSource)
	]);
	// selang-seling agar kedua sumber terlihat di hasil awal
	const merged: CoverResult[] = [];
	const max = Math.max(openLibrary.length, googleBooks.length);
	for (let i = 0; i < max; i++) {
		if (openLibrary[i]) merged.push(openLibrary[i]);
		if (googleBooks[i]) merged.push(googleBooks[i]);
	}
	return dedupeCovers(merged);
}

export const GET: RequestHandler = async ({ url }) => {
	const query = url.searchParams.get('q')?.trim();
	if (!query) return json({ covers: [] });
	const covers = await searchCovers(query, 6);
	return json({ covers });
};

export const POST: RequestHandler = async ({ request }) => {
	if (!(await isAuthenticated(request))) return json({ error: 'Unauthorized.' }, { status: 401 });
	const body = (await request.json().catch(() => ({}))) as { overwriteAll?: boolean };
	const library = await readLibrary();
	const targetBooks = library.books.filter((b) => body.overwriteAll || !b.coverUrl);

	if (targetBooks.length === 0) {
		return json({ ok: true, updatedCount: 0, library });
	}

	const updatedCovers = new Map<string, string>();

	for (const book of targetBooks) {
		const query = [book.title, book.authors[0]].filter(Boolean).join(' ');
		try {
			const covers = await searchCovers(query, 3);
			if (covers[0]?.url) updatedCovers.set(book.id, covers[0].url);
		} catch {
			// Ignore individual timeouts/network errors
		}
	}

	if (updatedCovers.size > 0) {
		await updateLibrary((data) => {
			for (const book of data.books) {
				const newCover = updatedCovers.get(book.id);
				if (newCover) book.coverUrl = newCover;
			}
		});
	}

	return json({
		ok: true,
		updatedCount: updatedCovers.size,
		totalChecked: targetBooks.length,
		library: await readLibrary()
	});
};
