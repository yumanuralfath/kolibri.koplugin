import { error } from '@sveltejs/kit';
import { isValidCoverName } from '../../../../../lib/server/covers';
import { getCover } from '../../../../../lib/server/database';
import type { RequestHandler } from './$types';

// Publik: dipakai juga oleh rak buku publik.
export const GET: RequestHandler = async ({ params }) => {
	if (!isValidCoverName(params.name)) throw error(404, 'Not found');
	const cover = await getCover(params.name);
	if (!cover) throw error(404, 'Not found');
	return new Response(cover.data as BodyInit, {
		headers: {
			'content-type': cover.mime,
			'cache-control': 'public, max-age=31536000, immutable',
			'x-content-type-options': 'nosniff'
		}
	});
};
