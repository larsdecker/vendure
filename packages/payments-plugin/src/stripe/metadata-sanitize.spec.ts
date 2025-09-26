import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';

import { sanitizeMetadata } from './metadata-sanitize';

describe('sanitizeMetadata', () => {
    it('returns an empty object when metadata is not an object', () => {
        // @ts-expect-error - testing runtime guard
        expect(sanitizeMetadata('invalid')).toEqual({});
    });

    it('filters out keys that are too long or have oversized values', () => {
        const metadata: Stripe.MetadataParam = {
            short: 'ok',
            ['l'.repeat(41)]: 'too long',
            longValue: 'x'.repeat(600),
        };

        const sanitized = sanitizeMetadata(metadata);

        expect(sanitized).toEqual({ short: 'ok' });
    });

    it('enforces the maximum number of keys', () => {
        const metadata: Stripe.MetadataParam = {};
        for (let i = 0; i < 60; i++) {
            metadata[`key_${i}`] = 'value';
        }

        const sanitized = sanitizeMetadata(metadata);

        expect(Object.keys(sanitized)).toHaveLength(50);
        expect(sanitized.key_0).toBe('value');
        expect(sanitized.key_49).toBe('value');
        expect(sanitized.key_50).toBeUndefined();
    });
});
