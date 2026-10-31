// Minimal ZIP reader and writer for DOCX files. Supports stored and raw
// deflate entries while preserving untouched compressed data.
import zlib from 'zlib';

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[n] = c >>> 0;
}

export function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function zipError(message) {
  throw new Error(message);
}

export function readZip(buf) {
  let eocd = -1;
  const first = Math.max(0, buf.length - 65557);
  for (let at = buf.length - 22; at >= first; at--) {
    if (buf.readUInt32LE(at) === 0x06054B50 && at + 22 + buf.readUInt16LE(at + 20) === buf.length) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) zipError('not a zip file: end record not found');
  if (eocd + 22 > buf.length) zipError('not a zip file: truncated end record');

  const disk = buf.readUInt16LE(eocd + 4);
  const directoryDisk = buf.readUInt16LE(eocd + 6);
  const diskEntries = buf.readUInt16LE(eocd + 8);
  const entryCount = buf.readUInt16LE(eocd + 10);
  const directorySize = buf.readUInt32LE(eocd + 12);
  const directoryOffset = buf.readUInt32LE(eocd + 16);
  if (disk || directoryDisk || diskEntries !== entryCount) zipError('multi-disk zip archives are not supported');
  if (diskEntries === 0xFFFF || entryCount === 0xFFFF || directorySize === 0xFFFFFFFF || directoryOffset === 0xFFFFFFFF) {
    zipError('ZIP64 archives are not supported');
  }
  if (directoryOffset + directorySize > eocd) zipError('invalid zip central directory');

  const entries = [];
  let at = directoryOffset;
  for (let i = 0; i < entryCount; i++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014B50) zipError('invalid zip central directory entry');
    const flags = buf.readUInt16LE(at + 8);
    const method = buf.readUInt16LE(at + 10);
    const compressedSize = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLength = buf.readUInt16LE(at + 32);
    const startDisk = buf.readUInt16LE(at + 34);
    const localOffset = buf.readUInt32LE(at + 42);
    if (compressedSize === 0xFFFFFFFF || size === 0xFFFFFFFF || localOffset === 0xFFFFFFFF) zipError('ZIP64 archives are not supported');
    if (startDisk) zipError('multi-disk zip archives are not supported');
    if (flags & 1) zipError('encrypted zip entries are not supported');
    if (method !== 0 && method !== 8) zipError(`zip compression method ${method} is not supported`);
    if (at + 46 + nameLength + extraLength + commentLength > buf.length) zipError('invalid zip central directory entry');
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034B50) zipError('invalid zip local header');
    if (buf.readUInt32LE(localOffset + 18) === 0xFFFFFFFF || buf.readUInt32LE(localOffset + 22) === 0xFFFFFFFF) {
      zipError('ZIP64 archives are not supported');
    }
    const localNameLength = buf.readUInt16LE(localOffset + 26);
    const localExtraLength = buf.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressedSize > buf.length) zipError('invalid zip entry data');
    entries.push({
      name: buf.toString('utf8', at + 46, at + 46 + nameLength),
      method,
      flags,
      crc: buf.readUInt32LE(at + 16),
      compressedSize,
      size,
      modTime: buf.readUInt16LE(at + 12),
      modDate: buf.readUInt16LE(at + 14),
      externalAttr: buf.readUInt32LE(at + 38),
      compressed: buf.slice(dataOffset, dataOffset + compressedSize),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function entryData(entry) {
  return entry.method === 0 ? entry.compressed : zlib.inflateRawSync(entry.compressed);
}

export function writeZip(entries) {
  const records = [];
  const localParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const replaced = Object.prototype.hasOwnProperty.call(entry, 'data');
    const data = replaced ? Buffer.from(entry.data) : null;
    const compressed = replaced ? zlib.deflateRawSync(data) : entry.compressed;
    const method = replaced ? 8 : entry.method;
    const flags = (entry.flags == null ? 0x0800 : entry.flags) & 0xFFF7;
    const crc = replaced ? crc32(data) : entry.crc;
    const size = replaced ? data.length : entry.size;
    const compressedSize = replaced ? compressed.length : entry.compressedSize;
    const modTime = entry.modTime || 0;
    const modDate = entry.modDate || 0;
    const externalAttr = entry.externalAttr || 0;
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034B50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(modTime, 10);
    local.writeUInt16LE(modDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressedSize, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    localParts.push(local, compressed);
    records.push({ name, flags, method, modTime, modDate, crc, compressedSize, size, externalAttr, offset });
    offset += local.length + compressed.length;
  }

  const centralParts = [];
  let centralSize = 0;
  for (const record of records) {
    const central = Buffer.alloc(46 + record.name.length);
    central.writeUInt32LE(0x02014B50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(record.flags, 8);
    central.writeUInt16LE(record.method, 10);
    central.writeUInt16LE(record.modTime, 12);
    central.writeUInt16LE(record.modDate, 14);
    central.writeUInt32LE(record.crc, 16);
    central.writeUInt32LE(record.compressedSize, 20);
    central.writeUInt32LE(record.size, 24);
    central.writeUInt16LE(record.name.length, 28);
    central.writeUInt32LE(record.externalAttr >>> 0, 38);
    central.writeUInt32LE(record.offset, 42);
    record.name.copy(central, 46);
    centralParts.push(central);
    centralSize += central.length;
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50, 0);
  end.writeUInt16LE(records.length, 8);
  end.writeUInt16LE(records.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, ...centralParts, end]);
}
