/**
 * ISO 7816-4 padding helpers (not built into node:crypto, which only does
 * PKCS#7). Pad by appending 0x80 followed by 0x00 bytes up to a block boundary.
 */

/** Pad with 0x80 followed by 0x00 bytes up to a multiple of `blockSize`. */
export function padIso7816(data: Buffer, blockSize: number): Buffer {
    const padLen = blockSize - (data.length % blockSize); // always 1..blockSize
    const padding = Buffer.alloc(padLen, 0);
    padding[0] = 0x80;
    return Buffer.concat([data, padding]);
}

/** Strip ISO 7816-4 padding; throws if the padding is not valid. */
export function unpadIso7816(data: Buffer, blockSize: number): Buffer {
    if (data.length === 0 || data.length % blockSize !== 0) {
        throw new Error('Input data is not padded');
    }
    let i = data.length - 1;
    while (i >= 0 && data[i] === 0x00) {
        i--;
    }
    if (i < 0 || data[i] !== 0x80) {
        throw new Error('Padding is incorrect.');
    }
    return data.subarray(0, i);
}
