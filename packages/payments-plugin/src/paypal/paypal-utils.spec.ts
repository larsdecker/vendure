import { CurrencyCode, LanguageCode, Logger, Order } from '@vendure/core';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    convertPaypalAmountToMinorUnits,
    createPaypalMetadata,
    formatMinorUnitAmount,
    formatPaypalAmount,
    getPaypalApiBase,
    parsePaypalMetadata,
    serializePaypalMetadata,
} from './paypal-utils';

describe('PayPal utilities', () => {
    const order = {
        currencyCode: CurrencyCode.USD,
        totalWithTax: 12345,
        code: 'TEST',
        id: 1,
    } as Order;

    it('returns sandbox api base by default', () => {
        expect(getPaypalApiBase()).toBe('https://api-m.sandbox.paypal.com');
    });

    it('returns live api base when environment is live', () => {
        expect(getPaypalApiBase('live')).toBe('https://api-m.paypal.com');
    });

    it('formats amounts with fractions for currencies with fractional units', () => {
        expect(formatPaypalAmount(order)).toBe('123.45');
    });

    it('formats amounts without fractions for zero-decimal currencies', () => {
        const zeroDecimalOrder = {
            ...order,
            currencyCode: CurrencyCode.JPY,
        } as Order;
        expect(formatPaypalAmount(zeroDecimalOrder)).toBe('123');
    });

    it('converts PayPal amount strings into Vendure minor units', () => {
        expect(convertPaypalAmountToMinorUnits('10.51', CurrencyCode.USD)).toBe(1051);
        expect(convertPaypalAmountToMinorUnits('10', CurrencyCode.JPY)).toBe(1000);
    });

    it('throws for invalid PayPal amounts', () => {
        expect(() => convertPaypalAmountToMinorUnits('NaN', CurrencyCode.USD)).toThrow(
            'Invalid PayPal amount "NaN"',
        );
    });

    it('serializes metadata and enforces size restrictions', () => {
        const metadata = createPaypalMetadata(order, 'token', LanguageCode.en, { foo: 'bar' });
        expect(metadata.serialized).toContain('"foo":"bar"');
        expect(metadata.metadata).toMatchObject({
            c: 'token',
            o: order.code,
            i: String(order.id),
            l: LanguageCode.en,
            foo: 'bar',
        });

        const largePayload = 'a'.repeat(128);
        expect(() =>
            serializePaypalMetadata({
                c: 'c',
                o: 'o',
                i: 'i',
                l: LanguageCode.en,
                largePayload,
            }),
        ).toThrow('PayPal metadata exceeds 127 characters');
    });

    describe('parsePaypalMetadata', () => {
        const loggerSpy = vi.spyOn(Logger, 'error').mockReturnValue(undefined);

        beforeEach(() => {
            loggerSpy.mockClear();
        });

        afterAll(() => {
            loggerSpy.mockRestore();
        });

        it('parses valid metadata', () => {
            const serialized = createPaypalMetadata(order, 'token', LanguageCode.en, {
                foo: 'bar',
            }).serialized;
            expect(parsePaypalMetadata(serialized)).toMatchObject({ foo: 'bar' });
            expect(loggerSpy).not.toHaveBeenCalled();
        });

        it('returns undefined and logs when parsing fails', () => {
            expect(parsePaypalMetadata('not-json')).toBeUndefined();
            expect(loggerSpy).toHaveBeenCalledTimes(1);
        });

        it('returns undefined when expected fields are missing', () => {
            const serialized = JSON.stringify({ foo: 'bar' });
            expect(parsePaypalMetadata(serialized)).toBeUndefined();
            expect(loggerSpy).toHaveBeenCalledTimes(1);
        });
    });

    it('formats minor unit amounts', () => {
        expect(formatMinorUnitAmount(1234, CurrencyCode.USD)).toBe('12.34');
        expect(formatMinorUnitAmount(1234, CurrencyCode.JPY)).toBe('12');
    });
});
