import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PaypalService } from '../../src/services/paypal.service';
import { PaypalHandlerConfig, PaypalPaymentMetadata } from '../../src/types/paypal-types';

vi.mock('@vendure/core', () => ({
    Logger: {
        verbose: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
    },
    Order: class {},
    RequestContext: class {},
}), { virtual: true });

describe('PaypalService', () => {
    let service: PaypalService;
    let fetchMock: ReturnType<typeof vi.spyOn>;
    const baseConfig: PaypalHandlerConfig = {
        clientId: 'client-id',
        clientSecret: 'client-secret',
        mode: 'sandbox',
        captureImmediately: true,
    };
    const order = {
        code: 'TEST',
        totalWithTax: 12345,
        currencyCode: 'USD',
    } as any;

    beforeEach(() => {
        service = new PaypalService();
        fetchMock = vi.spyOn(globalThis, 'fetch' as any);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function jsonResponse(body: unknown, status = 200) {
        return {
            ok: status >= 200 && status < 300,
            status,
            json: async () => body,
            text: async () => JSON.stringify(body),
        } as any;
    }

    it('creates a payment intent', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'token', expires_in: 3600 }));
        fetchMock.mockResolvedValueOnce(
            jsonResponse({
                id: 'ORDER123',
                status: 'CREATED',
                intent: 'CAPTURE',
                links: [{ rel: 'approve', href: 'https://paypal.test/approve', method: 'GET' }],
                purchase_units: [],
            }, 201),
        );
        const result = await service.createPaymentIntent(
            {} as any,
            order,
            baseConfig,
            {
                paymentMethodCode: 'paypal',
                returnUrl: 'https://example.com/success',
                cancelUrl: 'https://example.com/cancel',
            },
        );
        expect(result.id).toBe('ORDER123');
        expect(result.approveUrl).toBe('https://paypal.test/approve');
    });

    it('captures an order', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'token', expires_in: 3600 }));
        fetchMock.mockResolvedValueOnce(
            jsonResponse({
                id: 'ORDER123',
                status: 'COMPLETED',
                purchase_units: [
                    {
                        payments: {
                            captures: [
                                {
                                    id: 'CAPTURE123',
                                    status: 'COMPLETED',
                                    amount: { currency_code: 'USD', value: '123.45' },
                                },
                            ],
                        },
                    },
                ],
            }, 201),
        );
        const metadata: PaypalPaymentMetadata = {
            paypalOrderId: 'ORDER123',
            intent: 'CAPTURE',
        };
        const capture = await service.captureOrder({} as any, order, baseConfig, metadata);
        expect(capture.id).toBe('CAPTURE123');
    });

    it('authorizes an order', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'token', expires_in: 3600 }));
        fetchMock.mockResolvedValueOnce(
            jsonResponse({
                id: 'ORDER999',
                status: 'COMPLETED',
                purchase_units: [
                    {
                        payments: {
                            authorizations: [
                                {
                                    id: 'AUTH123',
                                    status: 'CREATED',
                                    amount: { currency_code: 'USD', value: '50.00' },
                                },
                            ],
                        },
                    },
                ],
            }, 201),
        );
        const metadata: PaypalPaymentMetadata = {
            paypalOrderId: 'ORDER999',
            intent: 'AUTHORIZE',
        };
        const authorization = await service.authorizeOrder({} as any, order, baseConfig, metadata);
        expect(authorization.id).toBe('AUTH123');
    });

    it('refunds a capture', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'token', expires_in: 3600 }));
        fetchMock.mockResolvedValueOnce(
            jsonResponse({
                id: 'REFUND123',
                status: 'COMPLETED',
                amount: { currency_code: 'USD', value: '10.00' },
            }, 201),
        );
        const refund = await service.refundCapture(baseConfig, 'CAPTURE123', 1000, 'USD' as any);
        expect(refund.id).toBe('REFUND123');
        expect(refund.status).toBe('COMPLETED');
    });
});
