import { crc32, deflateSync, inflateSync } from 'node:zlib';

/** Recompress scanline bytes; preserve color profiles, dimensions and every other PNG chunk. */
export function recompressPng(bytes) {
  // Some shipped .png avatar URLs contain JPEG bytes. Keep their existing format.
  if (!bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return bytes;
  const understood = new Set([
    'IHDR',
    'PLTE',
    'IDAT',
    'IEND',
    'cHRM',
    'gAMA',
    'iCCP',
    'sBIT',
    'sRGB',
    'bKGD',
    'hIST',
    'tRNS',
    'pHYs',
    'sPLT',
    'tIME',
    'iTXt',
    'tEXt',
    'zTXt',
    'eXIf',
    'cICP',
    'mDCV',
    'cLLI',
  ]);
  const chunks = [];
  let offset = 8;
  while (offset < bytes.length) {
    const end = offset + bytes.readUInt32BE(offset) + 12;
    if (end > bytes.length) throw new Error('Truncated avatar PNG');
    const raw = bytes.subarray(offset, end);
    if (crc32(raw.subarray(4, -4)) !== raw.readUInt32BE(raw.length - 4)) throw new Error('Invalid avatar PNG CRC');
    const kind = raw.toString('ascii', 4, 8);
    // caBX credentials and iDOT offsets occur in shipped avatars. PNG requires
    // preserving unknown unsafe-to-copy chunks together with their original IDAT.
    if (kind === 'acTL' || (!understood.has(kind) && (raw[7] & 32) === 0)) return bytes;
    chunks.push({ kind, raw });
    offset = end;
  }
  const compressed = Buffer.concat(chunks.filter(({ kind }) => kind === 'IDAT').map(({ raw }) => raw.subarray(8, -4)));
  const imageData = deflateSync(inflateSync(compressed), { level: 9 });
  const idat = Buffer.alloc(imageData.length + 12);
  idat.writeUInt32BE(imageData.length);
  idat.write('IDAT', 4);
  imageData.copy(idat, 8);
  idat.writeUInt32BE(crc32(idat.subarray(4, -4)), idat.length - 4);
  const first = chunks.findIndex(({ kind }) => kind === 'IDAT');
  const candidate = Buffer.concat([
    bytes.subarray(0, 8),
    ...chunks.flatMap(({ kind, raw }, index) => (kind !== 'IDAT' ? [raw] : index === first ? [idat] : [])),
  ]);
  return candidate.length < bytes.length ? candidate : bytes;
}
