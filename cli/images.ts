/**
 * Player photos: optimised once, stored as static assets in the repository and
 * served by Firebase Hosting. Square 512px WebP, EXIF-rotated, content-hashed
 * so a replaced photo is never served stale from a cache.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

export const PHOTO_DIR = resolve(process.cwd(), 'public/photos');

export interface PreparedPhoto {
  publicPath: string;
  bytes: number;
  /** Writes the file and removes this player's older photos. */
  write(): void;
}

export async function preparePhoto(inputPath: string, playerId: string): Promise<PreparedPhoto> {
  if (!existsSync(inputPath)) throw new Error(`Photo file not found: ${inputPath}`);
  let quality = 82;
  let buf = Buffer.alloc(0);
  for (; quality >= 50; quality -= 8) {
    buf = await sharp(inputPath)
      .rotate()
      .resize(512, 512, { fit: 'cover', position: 'attention' })
      .webp({ quality })
      .toBuffer();
    if (buf.length <= 90_000) break;
  }
  const hash = createHash('sha256').update(buf).digest('hex').slice(0, 8);
  const file = `${playerId}.${hash}.webp`;
  return {
    publicPath: `/photos/${file}`,
    bytes: buf.length,
    write() {
      mkdirSync(PHOTO_DIR, { recursive: true });
      for (const f of readdirSync(PHOTO_DIR)) {
        if (f.startsWith(`${playerId}.`) && f !== file) unlinkSync(join(PHOTO_DIR, f));
      }
      writeFileSync(join(PHOTO_DIR, file), buf);
    },
  };
}
