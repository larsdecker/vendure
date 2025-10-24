import nock from 'nock';
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('@vendure/core', () => ({
    Logger: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        verbose: vi.fn(),
    },
}));

import { PaypalService } from '../paypal.service';
import { PaypalHandlerArgs } from '../types';

const sandboxApi = 'https://api-m.sandbox.paypal.com';

describe('PaypalService', () => {
    const service = new PaypalService();
    const handlerArgs: PaypalHandlerArgs = {
        clientId: 'test-client-id',
        clientSecret: 'test-secret',
        mode: 'sandbox',
        intent: 'capture',
        currency: 'EUR',
    };

    beforeAll(() => {
        nock.disableNetConnect();
    });

    afterEach(() => {
        nock.cleanAll();
    });

    afterAll(() => {
        nock.enableNetConnect();
    });

    it('creates a PayPal order', async () => {
        const order = {
            code: 'T100',
            totalWithTax: 12345,
            currencyCode: 'EUR',
        } as any;
        mockTokenEndpoint();
        nock(sandboxApi)
            .post('/v2/checkout/orders')
            .reply(200, {
                id: 'ORDER123',
                status: 'CREATED',
                intent: 'CAPTURE',
                links: [{ rel: 'approve', href: 'https://paypal.test/approve' }],
            });
        const result = await service.createOrder({} as any, order, handlerArgs, {
            orderCode: order.code,
            amount: service.formatAmount(order.totalWithTax, order.currencyCode),
            currencyCode: order.currencyCode,
            intent: 'capture',
        });
        expect(result).toEqual({
            id: 'ORDER123',
            status: 'CREATED',
            intent: 'CAPTURE',
            approvalUrl: 'https://paypal.test/approve',
        });
    });

    it('captures a PayPal order using cached token', async () => {
        mockTokenEndpoint();
        nock(sandboxApi)
            .post('/v2/checkout/orders/ORDER123/capture')
            .reply(200, {
                purchase_units: [
                    {
                        payments: {
                            captures: [
                                {
                                    id: 'CAPTURE123',
                                    status: 'COMPLETED',
                                    amount: { currency_code: 'EUR', value: '123.45' },
                                },
                            ],
                        },
                    },
                ],
            });
        const capture = await service.captureOrder(handlerArgs, 'ORDER123');
        expect(capture.id).toBe('CAPTURE123');
        expect(capture.amount.value).toBe('123.45');
    });

    it('refunds a capture', async () => {
        mockTokenEndpoint();
        nock(sandboxApi)
            .post('/v2/payments/captures/CAPTURE123/refund', {
                amount: { currency_code: 'EUR', value: '12.34' },
            })
            .reply(200, {
                id: 'REFUND123',
                status: 'COMPLETED',
                amount: { currency_code: 'EUR', value: '12.34' },
            });
        const refund = await service.refundCapture(handlerArgs, 'CAPTURE123', '12.34', 'EUR');
        expect(refund.id).toBe('REFUND123');
    });

    it('reuses cached tokens across calls', async () => {
        mockTokenEndpoint();
        nock(sandboxApi)
            .post('/v2/checkout/orders/CACHE123/capture')
            .reply(200, {
                purchase_units: [
                    {
                        payments: {
                            captures: [
                                {
                                    id: 'CAPTURECACHE',
                                    status: 'COMPLETED',
                                    amount: { currency_code: 'EUR', value: '10.00' },
                                },
                            ],
                        },
                    },
                ],
            });
        nock(sandboxApi)
            .post('/v2/payments/captures/CAPTURECACHE/refund', {
                amount: { currency_code: 'EUR', value: '5.00' },
            })
            .reply(200, {
                id: 'REFUNDCACHE',
                status: 'COMPLETED',
                amount: { currency_code: 'EUR', value: '5.00' },
            });
        await service.captureOrder(handlerArgs, 'CACHE123');
        const refund = await service.refundCapture(handlerArgs, 'CAPTURECACHE', '5.00', 'EUR');
        expect(refund.id).toBe('REFUNDCACHE');
    });

    it('verifies webhook signatures', async () => {
        mockTokenEndpoint();
        nock(sandboxApi)
            .post('/v1/notifications/verify-webhook-signature')
            .reply(200, { verification_status: 'SUCCESS' });
        const valid = await service.verifyWebhookSignature(handlerArgs, {
            webhookId: 'hook-1',
            transmissionId: 'tid',
            transmissionTime: 'time',
            transmissionSig: 'sig',
            certUrl: 'https://paypal.test/cert',
            authAlgo: 'algo',
            body: JSON.stringify({ id: 'evt' }),
        });
        expect(valid).toBe(true);
    });

    it('converts amounts to minor units', () => {
        expect(service.toMinorUnit('123.45', 'EUR')).toBe(12345);
        expect(service.toMinorUnit('10', 'JPY')).toBe(1000);
    });

    function mockTokenEndpoint(): void {
        nock(sandboxApi)
            .post('/v1/oauth2/token')
            .basicAuth({ user: 'test-client-id', pass: 'test-secret' })
            .reply(200, { access_token: 'TOKEN', expires_in: 3600, token_type: 'Bearer' });
    }
});
