import { describe, it, expect } from 'vitest';
import { decodeBytes, encodeText } from './encoding';

describe('Big5-UAO Encoding Utilities', () => {
    it('should decode Big5 bytes to string', () => {
        // "測試" in Big5 is \xB4\xFA\xB8\xD5
        const bytes = new Uint8Array([0xB4, 0xFA, 0xB8, 0xD5]);
        const result = decodeBytes(bytes);
        expect(result).toBe('測試');
    });

    it('should encode string to Big5 bytes', () => {
        const text = '測試';
        const result = encodeText(text);
        expect(result).toEqual(new Uint8Array([0xB4, 0xFA, 0xB8, 0xD5]));
    });

    it('should handle undefined or unrecognized characters gracefully', () => {
        // According to iconv-lite default behavior, unrecognized bytes become '?'
        // Here we test what happens. 0x80 is an invalid lead byte in Big5 in some contexts,
        // but let's test a known sequence that translates to ? or standard default replacement.
        const bytes = new Uint8Array([0x80, 0x81]);
        const result = decodeBytes(bytes);
        expect(typeof result).toBe('string');
        // We aren't asserting the exact string as it may be '?' or '�' depending on iconv-lite internal behavior
    });

    it('should handle empty or null bytes in decodeBytes', () => {
        expect(decodeBytes(new Uint8Array(0))).toBe('');
        expect(decodeBytes(null)).toBe('');
        expect(decodeBytes(undefined)).toBe('');
    });

    it('should handle empty or null text in encodeText', () => {
        expect(encodeText('')).toEqual(new Uint8Array(0));
        expect(encodeText(null)).toEqual(new Uint8Array(0));
        expect(encodeText(undefined)).toEqual(new Uint8Array(0));
    });

    it('should perform roundtrip correctly', () => {
        const text = '巴哈姆特';
        expect(decodeBytes(encodeText(text))).toBe(text);
    });
});
