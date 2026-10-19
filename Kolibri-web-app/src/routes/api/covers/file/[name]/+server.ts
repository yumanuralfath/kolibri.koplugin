import { error } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import { coverMime, coverPath, isValidCoverName } from '../../../../../lib/server/covers';
import type { RequestHandler } from './$types';

// Publik: dipakai juga oleh rak buku publik.
export const GET: RequestHandler = async ({ params }) => {
	const name = params.name;
	if (!isValidCoverName(name)) throw error(404, 'Not found');
	try {
		const data = readFileSync(coverPath(name));
		return new Response(data, {
			headers: {
				'content-type': coverMime[name.split('.')[1]],
				'cache-control': 'public, max-age=31536000, immutable',
				'x-content-type-options': 'nosniff'
			}
		});
	} catch {
		throw error(404, 'Not found');
	}
};
