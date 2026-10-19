import { json } from '@sveltejs/kit';
import { isAuthenticated } from '../../../../lib/server/auth';
import {
	COVER_PREFIX,
	MAX_COVER_BYTES,
	detectImageExt,
	removeUploadedCover,
	saveCoverFile
} from '../../../../lib/server/covers';
import { readLibrary, updateLibrary } from '../../../../lib/server/library';
import type { RequestHandler } from './$types';

// Body = bytes gambar mentah, id buku lewat query ?bookId=
export const POST: RequestHandler = async ({ request, url }) => {
	if (!isAuthenticated(request)) return json({ error: 'Unauthorized.' }, { status: 401 });
	const bookId = url.searchParams.get('bookId') ?? '';
	const existing = readLibrary().books.find((b) => b.id === bookId);
	if (!existing) return json({ error: 'Buku tidak ditemukan.' }, { status: 404 });

	const buf = Buffer.from(await request.arrayBuffer());
	if (buf.length === 0) return json({ error: 'File kosong.' }, { status: 400 });
	if (buf.length > MAX_COVER_BYTES)
		return json({ error: 'Ukuran gambar maksimal 5 MB.' }, { status: 413 });
	const ext = detectImageExt(buf);
	if (!ext) return json({ error: 'Format harus JPG, PNG, WebP, atau GIF.' }, { status: 415 });

	const name = saveCoverFile(buf, ext);
	const oldCover = existing.coverUrl;
	const library = updateLibrary((data) => {
		const book = data.books.find((b) => b.id === bookId);
		if (book) book.coverUrl = `${COVER_PREFIX}${name}`;
	});
	removeUploadedCover(oldCover);
	return json(library);
};
