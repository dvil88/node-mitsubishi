/**
 * Small byte/buffer helpers used by the protocol parser.
 */

/** Return the numeric values of a numeric enum object. */
export function enumValues(enumObj: Record<string, string | number>): number[] {
    return Object.values(enumObj).filter((v): v is number => typeof v === 'number');
}

/** Compare a slice of `data` against the given byte sequence. */
export function bytesEqual(actual: Buffer, expected: number[]): boolean {
    if (actual.length !== expected.length) {
        return false;
    }
    for (let i = 0; i < expected.length; i++) {
        if (actual[i] !== expected[i]) {
            return false;
        }
    }
    return true;
}

/** `true` if every byte in the slice equals 0x00. */
export function allZero(data: Buffer): boolean {
    return data.every((b) => b === 0);
}

/** Hex-encode a buffer. */
export function hex(data: Buffer): string {
    return data.toString('hex');
}
