import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { getSetting, setInitialSettings, setSetting } from './database';

const cookieName = 'kolibri_session';
const sessionLifetime = 60 * 60 * 24 * 14;

function equal(left: string, right: string): boolean {
	const leftBuffer = Buffer.from(left);
	const rightBuffer = Buffer.from(right);
	return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function isSetupRequired(): boolean {
	return !getSetting('passwordHash') || !getSetting('passwordSalt');
}

export function setupAdmin(password: string): string {
	if (!isSetupRequired()) throw new Error('Kolibri is already configured.');
	const salt = randomBytes(16).toString('hex');
	const passwordHash = scryptSync(password, salt, 64).toString('hex');
	const sessionSecret = randomBytes(32).toString('base64url');
	const syncToken = randomBytes(32).toString('base64url');
	if (!setInitialSettings({ passwordSalt: salt, passwordHash, sessionSecret, syncToken })) {
		throw new Error('Kolibri is already configured.');
	}
	return syncToken;
}

export function verifyPassword(password: string): boolean {
	const salt = getSetting('passwordSalt');
	const expected = getSetting('passwordHash');
	if (!salt || !expected) return false;
	const actual = scryptSync(password, salt, 64).toString('hex');
	return equal(actual, expected);
}

function sign(value: string): string {
	const sessionSecret = getSetting('sessionSecret');
	if (!sessionSecret) return '';
	return createHmac('sha256', sessionSecret).update(value).digest('base64url');
}

export function createSession(): string {
	const value = `${Date.now() + sessionLifetime * 1000}.${randomUUID()}`;
	return `${value}.${sign(value)}`;
}

export function isAuthenticated(request: Request): boolean {
	if (isSetupRequired() || !getSetting('sessionSecret')) return false;
	const cookie = request.headers.get('cookie') ?? '';
	const value = cookie
		.split(';')
		.map((part) => part.trim())
		.find((part) => part.startsWith(`${cookieName}=`))
		?.slice(cookieName.length + 1);
	if (!value) return false;
	const [expires, nonce, signature] = value.split('.');
	if (!expires || !nonce || !signature || Number(expires) < Date.now()) return false;
	return equal(signature, sign(`${expires}.${nonce}`));
}

export function getSyncToken(): string {
	return getSetting('syncToken') ?? '';
}

export function rotateSyncToken(): string {
	const token = randomBytes(32).toString('base64url');
	setSetting('syncToken', token);
	return token;
}

export function hasSyncToken(request: Request): boolean {
	const expected = getSyncToken();
	const received = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
	return Boolean(expected && received && equal(received, expected));
}
