import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { getSetting, setInitialSettings, setSettings } from './database';

const cookieName = 'kolibri_session';
const sessionLifetime = 60 * 60 * 24 * 14;

function equal(left: string, right: string): boolean {
	const leftBuffer = Buffer.from(left);
	const rightBuffer = Buffer.from(right);
	return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export async function isSetupRequired(): Promise<boolean> {
	return !(await getSetting('passwordHash')) || !(await getSetting('passwordSalt'));
}

export async function setupAdmin(password: string): Promise<void> {
	if (!(await isSetupRequired())) throw new Error('Kolibri is already configured.');
	const salt = randomBytes(16).toString('hex');
	const passwordHash = scryptSync(password, salt, 64).toString('hex');
	const sessionSecret = randomBytes(32).toString('base64url');
	if (!(await setInitialSettings({ passwordSalt: salt, passwordHash, sessionSecret }))) {
		throw new Error('Kolibri is already configured.');
	}
}

export async function verifyPassword(password: string): Promise<boolean> {
	const salt = await getSetting('passwordSalt');
	const expected = await getSetting('passwordHash');
	if (!salt || !expected) return false;
	const actual = scryptSync(password, salt, 64).toString('hex');
	return equal(actual, expected);
}

async function sign(value: string): Promise<string> {
	const sessionSecret = await getSetting('sessionSecret');
	if (!sessionSecret) return '';
	return createHmac('sha256', sessionSecret).update(value).digest('base64url');
}

export async function createSession(): Promise<string> {
	const value = `${Date.now() + sessionLifetime * 1000}.${randomUUID()}`;
	return `${value}.${await sign(value)}`;
}

export async function isAuthenticated(request: Request): Promise<boolean> {
	if ((await isSetupRequired()) || !(await getSetting('sessionSecret'))) return false;
	const cookie = request.headers.get('cookie') ?? '';
	const value = cookie
		.split(';')
		.map((part) => part.trim())
		.find((part) => part.startsWith(`${cookieName}=`))
		?.slice(cookieName.length + 1);
	if (!value) return false;
	const [expires, nonce, signature] = value.split('.');
	if (!expires || !nonce || !signature || Number(expires) < Date.now()) return false;
	return equal(signature, await sign(`${expires}.${nonce}`));
}

export async function changePassword(password: string): Promise<void> {
	const salt = randomBytes(16).toString('hex');
	const passwordHash = scryptSync(password, salt, 64).toString('hex');
	await setSettings({
		passwordSalt: salt,
		passwordHash,
		sessionSecret: randomBytes(32).toString('base64url')
	});
}

export async function hasSyncPassword(request: Request): Promise<boolean> {
	const received = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
	return Boolean(received && (await verifyPassword(received)));
}
