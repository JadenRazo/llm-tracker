// Just enough ZIP and CSV to read a published data archive with Node built-ins.
// Both readers refuse anything they do not understand instead of guessing.

import { crc32, inflateRawSync } from "node:zlib";

const MAX_ENTRY_BYTES = 8 * 1024 * 1024;

/**
 * Extract named files from a ZIP held in memory. Supports stored and deflated
 * entries, which is what the archive uses, and verifies each entry's CRC-32.
 * ZIP64, encryption and multi-disk archives are rejected.
 */
export function unzipFiles(archive: Uint8Array, names: readonly string[]): Map<string, string> {
  const buffer = Buffer.from(archive.buffer, archive.byteOffset, archive.byteLength);
  // End of central directory: fixed 22 bytes plus an optional comment (max 65535).
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 65535); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error("Archive has no ZIP directory");
  const entries = buffer.readUInt16LE(end + 10), directorySize = buffer.readUInt32LE(end + 12), directoryOffset = buffer.readUInt32LE(end + 16);
  if (buffer.readUInt16LE(end + 4) !== 0 || entries === 0xffff || directoryOffset === 0xffffffff) throw new Error("Unsupported ZIP archive (ZIP64 or multi-disk)");
  if (directoryOffset + directorySize > end) throw new Error("ZIP directory is out of bounds");

  const wanted = new Set(names), found = new Map<string, string>();
  let cursor = directoryOffset;
  for (let i = 0; i < entries; i++) {
    if (cursor + 46 > end || buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error("ZIP directory entry is malformed");
    const flags = buffer.readUInt16LE(cursor + 8), method = buffer.readUInt16LE(cursor + 10);
    const checksum = buffer.readUInt32LE(cursor + 16), compressedSize = buffer.readUInt32LE(cursor + 20), size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28), extraLength = buffer.readUInt16LE(cursor + 30), commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;
    if (!wanted.has(name)) continue;
    if (found.has(name)) throw new Error(`ZIP lists ${name} twice`);
    if (flags & 0x1) throw new Error(`ZIP entry ${name} is encrypted`);
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) throw new Error(`ZIP entry ${name} needs ZIP64`);
    if (size > MAX_ENTRY_BYTES) throw new Error(`ZIP entry ${name} exceeds ${MAX_ENTRY_BYTES} bytes`);
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`ZIP entry ${name} has no local header`);
    const start = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    if (start + compressedSize > buffer.length) throw new Error(`ZIP entry ${name} is truncated`);
    const raw = buffer.subarray(start, start + compressedSize);
    let data: Buffer;
    if (method === 0) data = raw;
    else if (method === 8) data = inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES });
    else throw new Error(`ZIP entry ${name} uses unsupported compression ${method}`);
    if (data.length !== size) throw new Error(`ZIP entry ${name} has the wrong length`);
    if (crc32(data) !== checksum) throw new Error(`ZIP entry ${name} failed its checksum`);
    found.set(name, data.toString("utf8"));
  }
  for (const name of names) if (!found.has(name)) throw new Error(`Archive is missing ${name}`);
  return found;
}

/** RFC 4180 CSV with a header row: quoted fields, doubled quotes, embedded newlines. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "", row: string[] = [], quoted = false;
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"') { if (source[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && source[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (quoted) throw new Error("CSV ends inside a quoted field");
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  if (!header?.length) throw new Error("CSV has no header row");
  if (new Set(header).size !== header.length) throw new Error("CSV header repeats a column");
  return body.map((cells, index) => {
    if (cells.length !== header.length) throw new Error(`CSV row ${index + 2} has ${cells.length} fields, expected ${header.length}`);
    return Object.fromEntries(header.map((name, i) => [name, cells[i]]));
  });
}
