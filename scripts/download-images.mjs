import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { products } from '../src/data/products.js';
import { getImageFileName } from '../src/utils/imagePath.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const outputDir = path.resolve(__dirname, '../public/images');

await mkdir(outputDir, { recursive: true });

const downloadImage = async (url, destination) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  await writeFile(destination, Buffer.from(arrayBuffer));
};

for (const product of products) {
  const filename = getImageFileName(product.image);
  if (!filename) continue;

  const destination = path.join(outputDir, filename);
  if (existsSync(destination)) {
    console.log(`Skipping ${filename}, already exists.`);
    continue;
  }

  console.log(`Downloading ${product.image} -> ${filename}`);
  try {
    await downloadImage(product.image, destination);
  } catch (error) {
    console.error(`❌ ${error.message}`);
  }
}

console.log('Image download complete.');

