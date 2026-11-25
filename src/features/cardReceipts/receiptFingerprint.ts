/**
 * A receipt file's fingerprint (SHA-256, hex) taken from the file as picked, before the browser shrinks it, so the
 * same photo chosen twice gives the same fingerprint (src/utils/receiptFile.ts). '' when the browser can't work it
 * out (no Web Crypto outside https, or the file can't be read): the server then fingerprints what it receives.
 */
export async function fingerprintOf(file: Blob): Promise<string> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return '';
    const digest = await subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return '';
  }
}
