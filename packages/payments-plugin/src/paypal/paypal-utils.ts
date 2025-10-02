import { CurrencyCode, LanguageCode, Logger, Order } from '@vendure/core';

import { loggerCtx } from './constants';

export interface PaypalMetadata {
    c: string;
    o: string;
    i: string;
    l: LanguageCode;
    [key: string]: string;
}

export function getPaypalApiBase(environment: 'sandbox' | 'live' = 'sandbox'): string {
    return environment === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

export function formatPaypalAmount(order: Order): string {
    if (currencyHasFractionPart(order.currencyCode)) {
        return (order.totalWithTax / 100).toFixed(2);
    }
    return Math.round(order.totalWithTax / 100).toString();
}

export function convertPaypalAmountToMinorUnits(amount: string, currencyCode: CurrencyCode): number {
    const numericAmount = Number.parseFloat(amount);
    if (Number.isNaN(numericAmount)) {
        throw new Error(`Invalid PayPal amount "${amount}"`);
    }
    if (currencyHasFractionPart(currencyCode)) {
        return Math.round(numericAmount * 100);
    }
    return Math.round(numericAmount) * 100;
}

export function serializePaypalMetadata(metadata: PaypalMetadata): string {
    const serialized = JSON.stringify(metadata);
    if (serialized.length > 127) {
        throw new Error(
            'PayPal metadata exceeds 127 characters. Reduce the amount of metadata you attach to the purchase unit.',
        );
    }
    return serialized;
}

export function createPaypalMetadata(
    order: Order,
    channelToken: string,
    languageCode: LanguageCode,
    additional: Record<string, string> = {},
): { metadata: PaypalMetadata; serialized: string } {
    const metadata: PaypalMetadata = {
        c: channelToken,
        o: order.code,
        i: String(order.id),
        l: languageCode,
        ...additional,
    };

    const serialized = serializePaypalMetadata(metadata);
    return { metadata, serialized };
}

export function parsePaypalMetadata(value: string | undefined): PaypalMetadata | undefined {
    if (!value) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(value) as PaypalMetadata;
        if (!parsed.c || !parsed.o || !parsed.i) {
            throw new Error('Missing expected metadata fields');
        }
        return parsed;
    } catch (err: any) {
        Logger.error(`Unable to parse PayPal metadata: ${(err as Error).message}`, loggerCtx);
        return undefined;
    }
}

function currencyHasFractionPart(currencyCode: CurrencyCode): boolean {
    const parts = new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: currencyCode,
        currencyDisplay: 'symbol',
    }).formatToParts(123.45);

    return parts.some(p => p.type === 'fraction');
}
export function formatMinorUnitAmount(amount: number, currencyCode: CurrencyCode): string {
    if (currencyHasFractionPart(currencyCode)) {
        return (amount / 100).toFixed(2);
    }
    return Math.round(amount / 100).toString();
}
