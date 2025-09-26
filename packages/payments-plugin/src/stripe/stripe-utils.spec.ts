import { describe, expect, it } from 'vitest';

import {
    getAmountFromStripeMinorUnits,
    getAmountInStripeMinorUnits,
    isExpectedVendureStripeEventMetadata,
} from './stripe-utils';

type TestOrder = { currencyCode: string; totalWithTax: number };

describe('stripe utils', () => {
    it('converts Vendure amounts to Stripe minor units for fractional currencies', () => {
        const order: TestOrder = {
            currencyCode: 'USD',
            totalWithTax: 1999,
        };

        expect(getAmountInStripeMinorUnits(order as any)).toBe(1999);
    });

    it('converts Vendure amounts to Stripe minor units for zero-decimal currencies', () => {
        const order: TestOrder = {
            currencyCode: 'JPY',
            totalWithTax: 12300,
        };

        expect(getAmountInStripeMinorUnits(order as any)).toBe(123);
    });

    it('converts Stripe minor units back to Vendure amounts', () => {
        const usdOrder: TestOrder = {
            currencyCode: 'USD',
            totalWithTax: 0,
        };
        const jpyOrder: TestOrder = {
            currencyCode: 'JPY',
            totalWithTax: 0,
        };

        expect(getAmountFromStripeMinorUnits(usdOrder as any, 1999)).toBe(1999);
        expect(getAmountFromStripeMinorUnits(jpyOrder as any, 123)).toBe(12300);
    });

    it('validates metadata payloads expected by the Stripe webhook handler', () => {
        expect(
            isExpectedVendureStripeEventMetadata({
                channelToken: 'token',
                orderCode: '123',
                orderId: '1',
            } as any),
        ).toBe(true);
        expect(
            isExpectedVendureStripeEventMetadata({
                channelToken: 'token',
            } as any),
        ).toBe(false);
    });
});
