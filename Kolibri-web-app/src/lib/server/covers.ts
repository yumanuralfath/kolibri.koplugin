import { randomBytes } from 'node:crypto';
import { deleteCover, saveCover } from './database';

export const COVER_PREFIX = '/api/covers/file/';
// Batas body fungsi serverless Vercel ~4.5 MB; browser sudah memperkecil gambar sebelum upload.
export const MAX_COVER_BYTES = 4 * 1024 * 1024;

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

/** Deteksi tipe gambar dari magic bytes; null jika bukan gambar yang didukung. */
export function detectImageExt(buf: Uint8Array): 'jpg' | 'png' | 'webp' | 'gif' | null {
	const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
	if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
	if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
		return 'png';
	if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP')
		return 'webp';
	if (b.length > 6 && (b.toString('ascii', 0, 6) === 'GIF87a' || b.toString('ascii', 0, 6) === 'GIF89a'))
		return 'gif';
	return null;
}

export async function saveCoverFile(buf: Uint8Array, ext: string): Promise<string> {
	const name = `${randomBytes(12).toString('hex')}.${ext}`;
	await saveCover(name, coverMime[ext], buf);
	return name;
}

/** Hapus sampul unggahan lama dari database bila coverUrl menunjuk ke sana. */
export async function removeUploadedCover(coverUrl?: string): Promise<void> {
	if (!coverUrl?.startsWith(COVER_PREFIX)) return;
	const name = coverUrl.slice(COVER_PREFIX.length);
	if (!isValidCoverName(name)) return;
	await deleteCover(name).catch(() => {});
}
