import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { getSetting, setInitialSettings, setSettings } from './database';

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

export function setupAdmin(password: string): void {
	if (!isSetupRequired()) throw new Error('Kolibri is already configured.');
	const salt = randomBytes(16).toString('hex');
	const passwordHash = scryptSync(password, salt, 64).toString('hex');
	const sessionSecret = randomBytes(32).toString('base64url');
	if (!setInitialSettings({ passwordSalt: salt, passwordHash, sessionSecret })) {
		throw new Error('Kolibri is already configured.');
	}
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

export function changePassword(password: string): void {
	const salt = randomBytes(16).toString('hex');
	const passwordHash = scryptSync(password, salt, 64).toString('hex');
	setSettings({
		passwordSalt: salt,
		passwordHash,
		sessionSecret: randomBytes(32).toString('base64url')
	});
}

export function hasSyncPassword(request: Request): boolean {
	const received = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
	return Boolean(received && verifyPassword(received));
}
