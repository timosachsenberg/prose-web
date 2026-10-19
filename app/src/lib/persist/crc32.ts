// CRC-32 (the zip checksum), to tell a damaged project file from a good one. fflate checks nothing.

const tables: Int32Array[] = (() => {
  const t0 = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t0[n] = c
  }
  // slicing by four: the tables for a byte that is 1, 2 and 3 bytes ahead
  const all = [t0]
  for (let s = 1; s < 4; s++) {
    const t = new Int32Array(256)
    for (let n = 0; n < 256; n++) t[n] = (all[s - 1][n] >>> 8) ^ t0[all[s - 1][n] & 0xff]
    all.push(t)
  }
  return all
})()

/** The CRC-32 of `data` (continuing `crc`, the result of an earlier call). */
export function crc32(data: Uint8Array, crc = 0): number {
  const [t0, t1, t2, t3] = tables
  let c = ~crc
  let i = 0
  const n = data.length
  for (; i + 4 <= n; i += 4) {
    c ^= data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24)
    c = t3[c & 0xff] ^ t2[(c >>> 8) & 0xff] ^ t1[(c >>> 16) & 0xff] ^ t0[c >>> 24]
  }
  for (; i < n; i++) c = t0[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return ~c >>> 0
}
