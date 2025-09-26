import { Transaction } from 'braintree';
import { describe, expect, it } from 'vitest';

import { defaultExtractMetadataFn } from './braintree-common';

function createTransaction(overrides: Partial<Transaction> = {}): Transaction {
    const base: Partial<Transaction> = {
        status: 'settled',
        currencyIsoCode: 'USD',
        merchantAccountId: 'merchant-account',
        cvvResponseCode: 'M',
        avsPostalCodeResponseCode: 'N',
        avsStreetAddressResponseCode: 'I',
        processorAuthorizationCode: 'auth-1',
        processorResponseText: 'Approved',
        paymentInstrumentType: 'credit_card',
        creditCard: {
            cardType: 'Visa',
            last4: '4242',
            expirationDate: '12/29',
        } as Transaction['creditCard'],
    };
    return { ...base, ...overrides } as Transaction;
}

describe('defaultExtractMetadataFn', () => {
    it('returns card metadata when a credit card was used', () => {
        const transaction = createTransaction();

        const metadata = defaultExtractMetadataFn(transaction);

        expect(metadata.cardData).toEqual({
            cardType: 'Visa',
            last4: '4242',
            expirationDate: '12/29',
        });
        expect(metadata.public.cardData).toEqual(metadata.cardData);
        expect(metadata.cvvCheck).toBe('Matched');
        expect(metadata.avsPostCodeCheck).toBe('Not Matched');
        expect(metadata.avsStreetAddressCheck).toBe('Not Provided');
    });

    it('includes PayPal metadata when the transaction contains PayPal details', () => {
        const transaction = createTransaction({
            paymentInstrumentType: 'paypal_account',
            creditCard: undefined,
            paypalAccount: {
                authorizationId: 'AUTH-123',
                payerEmail: 'buyer@example.com',
                payerStatus: 'VERIFIED',
                paymentId: 'PAY-123',
                sellerProtectionStatus: 'ELIGIBLE',
                transactionFeeAmount: '1.23',
            } as Transaction['paypalAccount'],
        });

        const metadata = defaultExtractMetadataFn(transaction);

        expect(metadata.paypalData).toEqual({
            authorizationId: 'AUTH-123',
            payerEmail: 'buyer@example.com',
            payerStatus: 'VERIFIED',
            paymentId: 'PAY-123',
            sellerProtectionStatus: 'ELIGIBLE',
            transactionFeeAmount: '1.23',
        });
        expect(metadata.public.paypalData).toEqual({ authorizationId: 'AUTH-123' });
    });

    it('handles missing optional values gracefully', () => {
        const transaction = createTransaction({
            cvvResponseCode: undefined,
            avsPostalCodeResponseCode: undefined,
            avsStreetAddressResponseCode: undefined,
            creditCard: undefined,
            paypalAccount: {
                authorizationId: 'AUTH-ONLY',
            } as Transaction['paypalAccount'],
        });

        const metadata = defaultExtractMetadataFn(transaction);

        expect(metadata.cvvCheck).toBe('Unknown');
        expect(metadata.avsPostCodeCheck).toBe('Unknown');
        expect(metadata.avsStreetAddressCheck).toBe('Unknown');
        expect(metadata.paypalData).toEqual({ authorizationId: 'AUTH-ONLY' });
        expect(metadata.public.paypalData).toEqual({ authorizationId: 'AUTH-ONLY' });
    });
});
