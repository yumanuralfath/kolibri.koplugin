import { json } from '@sveltejs/kit';
import {
	createSession,
	isAuthenticated,
	isSetupRequired,
	setupAdmin,
	verifyPassword
} from '../../../lib/server/auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ request }) =>
	json({ authenticated: isAuthenticated(request), setupRequired: isSetupRequired() });

export const POST: RequestHandler = async ({ request, cookies, url }) => {
	const body = (await request.json().catch(() => null)) as {
		password?: string;
		setup?: boolean;
	} | null;
	if (isSetupRequired()) {
		if (!body?.setup) return json({ error: 'Initial setup required.' }, { status: 409 });
		if (!body.password || body.password.length < 12) {
			return json({ error: 'Password harus berisi minimal 12 karakter.' }, { status: 400 });
		}
		try {
			setupAdmin(body.password);
		} catch {
			return json(
				{ error: 'Setup sudah selesai. Muat ulang halaman untuk masuk.' },
				{ status: 409 }
			);
		}
	} else if (!body?.password || !verifyPassword(body.password)) {
		return json({ error: 'Password tidak cocok.' }, { status: 401 });
	}
	cookies.set('kolibri_session', createSession(), {
		httpOnly: true,
		secure: url.protocol === 'https:',
		sameSite: 'strict',
		path: '/',
		maxAge: 60 * 60 * 24 * 14
	});
	return json({ authenticated: true });
};

export const DELETE: RequestHandler = ({ cookies }) => {
	cookies.delete('kolibri_session', { path: '/' });
	return json({ authenticated: false });
};
