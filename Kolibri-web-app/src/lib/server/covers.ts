import { randomBytes } from 'node:crypto';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const COVER_PREFIX = '/api/covers/file/';
export const MAX_COVER_BYTES = 5 * 1024 * 1024;

const coversDir = join(process.cwd(), 'data', 'covers');
mkdirSync(coversDir, { recursive: true, mode: 0o700 });

const nameRe = /^[a-f0-9]{24}\.(jpg|png|webp|gif)$/;

export const coverMime: Record<string, string> = {
	jpg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp',
	gif: 'image/gif'
};

export function isValidCoverName(name: string): boolean {
	return nameRe.test(name);
}

export function coverPath(name: string): string {
	return join(coversDir, name);
}

/** Deteksi tipe gambar dari magic bytes; null jika bukan gambar yang didukung. */
export function detectImageExt(buf: Buffer): 'jpg' | 'png' | 'webp' | 'gif' | null {
	if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
	if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
		return 'png';
	if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP')
		return 'webp';
	if (buf.length > 6 && (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a'))
		return 'gif';
	return null;
}

export function saveCoverFile(buf: Buffer, ext: string): string {
	const name = `${randomBytes(12).toString('hex')}.${ext}`;
	writeFileSync(coverPath(name), buf, { mode: 0o600 });
	return name;
}

/** Hapus file sampul unggahan lama bila coverUrl menunjuk ke sana. */
export function removeUploadedCover(coverUrl?: string): void {
	if (!coverUrl?.startsWith(COVER_PREFIX)) return;
	const name = coverUrl.slice(COVER_PREFIX.length);
	if (!isValidCoverName(name)) return;
	try {
		unlinkSync(coverPath(name));
	} catch {
		// file sudah tidak ada
	}
}
