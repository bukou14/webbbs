import iconv from 'iconv-lite';
import { Buffer } from 'buffer';

export function decodeBytes(bytes?: Uint8Array | null): string {
    if (!bytes || bytes.length === 0) {
        return '';
    }
    // Using default replacement character '?' is default behavior in iconv-lite
    // when a character is not recognized.
    return iconv.decode(Buffer.from(bytes), 'big5');
}

export function encodeText(text?: string | null): Uint8Array {
    if (!text) {
        return new Uint8Array(0);
    }
    const buf = iconv.encode(text, 'big5');
    // Convert Node Buffer to pure Uint8Array to avoid leaking Node Buffer to the browser client code
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/** Stateful Big5 decoder: Big5 multibyte chars can be split across WS frames. */
export function createBig5Decoder(): (bytes: Uint8Array) => string {
    const decoder = iconv.getDecoder('big5');
    return (bytes: Uint8Array) => decoder.write(Buffer.from(bytes));
}

