/**
 * Makes the iOS app icon and launch image from public/favicon.png (the gold mark):
 * the mark centred on the dark brand ground, no transparency (Apple refuses an
 * icon with an alpha channel). Run: node scripts/make-ios-icons.ts
 * The source mark is only 156 × 203 px, so the large sizes are a little soft —
 * replace public/favicon.png with a bigger copy of the mark and run this again.
 */
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const BG = { r: 20, g: 19, b: 15 };

async function compose(size: number, markHeight: number, out: string) {
  const mark = await sharp(join(root, 'public/favicon.png')).resize({ height: markHeight, kernel: 'lanczos3' }).toBuffer();
  await sharp({ create: { width: size, height: size, channels: 3, background: BG } })
    .composite([{ input: mark, gravity: 'center' }]).flatten({ background: BG }).removeAlpha().png().toFile(out);
}

const assets = join(root, 'ios/App/App/Assets.xcassets');
await compose(1024, 620, join(assets, 'AppIcon.appiconset/AppIcon-512@2x.png'));
for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
  await compose(2732, 520, join(assets, 'Splash.imageset', name));
}
console.log('iOS icon and launch image written');
