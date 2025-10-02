import { ModuleRef } from '@nestjs/core';
import { CurrencyCode, LanguageCode, Logger, Order, Payment, RequestContext } from '@vendure/core';
import fetch from 'node-fetch';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { paypalPaymentMethodHandler } from './paypal.handler';
import { PaypalService } from './paypal.service';
import { PaypalPluginOptions, PaypalWebhookEvent, PaypalWebhookHeaders } from './types';

vi.mock('node-fetch', () => ({
    default: vi.fn(),
}));

type FetchMock = ReturnType<typeof vi.fn>;

describe('PaypalService', () => {
    const fetchMock = fetch as unknown as FetchMock;
    const ctx = {
        channel: { token: 'channel-token' },
        languageCode: LanguageCode.en,
    } as RequestContext;
    const order = {
        id: 1,
        code: 'ORDER',
        currencyCode: CurrencyCode.USD,
        totalWithTax: 5432,
    } as Order;

    beforeEach(() => {
        fetchMock.mockReset();
    });

    function createService(
        options: Partial<PaypalPluginOptions> = {},
        paymentMethodOverrides?: {
            eligible?: Array<{ code: string }>;
            methodArgs?: Array<{ name: string; value?: string | null }>;
            includeMethod?: boolean;
        },
    ) {
        const methodArgs =
            paymentMethodOverrides?.methodArgs ??
            ([
                { name: 'clientId', value: 'client' },
                { name: 'clientSecret', value: 'secret' },
                { name: 'webhookId', value: 'webhook' },
            ] as Array<{ name: string; value?: string | null }>);
        const paymentMethod = {
            code: 'paypal-method',
            handler: {
                code: paypalPaymentMethodHandler.code,
                args: methodArgs,
            },
        };
        const paymentMethodService = {
            getEligiblePaymentMethods: vi
                .fn()
                .mockResolvedValue(paymentMethodOverrides?.eligible ?? [{ code: 'paypal-method' }]),
            findAll: vi.fn().mockResolvedValue({
                items: paymentMethodOverrides?.includeMethod === false ? [] : [paymentMethod],
            }),
        };
        const moduleRef = {
            get: vi.fn(),
            resolve: vi.fn(),
        } as unknown as ModuleRef;

        const service = new PaypalService(
            {
                environment: 'sandbox',
                intent: 'CAPTURE',
                ...options,
            } as PaypalPluginOptions,
            paymentMethodService as any,
            moduleRef,
        );

        return { service, paymentMethodService, paymentMethod };
    }

    it('creates an order with additional metadata and custom purchase unit', async () => {
        const metadataFn = vi.fn().mockResolvedValue({ attempt: 1, nullable: null });
        const purchaseUnitFn = vi.fn().mockImplementation((_, __, ___, defaultPurchaseUnit) => ({
            ...defaultPurchaseUnit,
            description: 'Custom',
        }));
        const applicationContextFn = vi.fn().mockResolvedValue({ shipping_preference: 'NO_SHIPPING' });

        const { service } = createService({
            metadata: metadataFn,
            purchaseUnit: purchaseUnitFn,
            applicationContext: applicationContextFn,
        });

        fetchMock
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ access_token: 'token' }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ id: 'paypal-order', status: 'CREATED' }),
            });

        const result = await service.createOrder(ctx, order);

        expect(result).toEqual({ id: 'paypal-order', status: 'CREATED' });
        expect(metadataFn).toHaveBeenCalledOnce();
        expect(purchaseUnitFn).toHaveBeenCalledOnce();
        expect(applicationContextFn).toHaveBeenCalledOnce();

        expect(fetchMock.mock.calls[0][0]).toContain('/v1/oauth2/token');
        expect(fetchMock.mock.calls[1][0]).toContain('/v2/checkout/orders');

        const orderRequest = JSON.parse(fetchMock.mock.calls[1][1].body as string);
        expect(orderRequest.intent).toBe('CAPTURE');
        expect(orderRequest.application_context).toEqual({ shipping_preference: 'NO_SHIPPING' });
        expect(orderRequest.purchase_units).toHaveLength(1);
        expect(orderRequest.purchase_units[0].description).toBe('Custom');

        const parsedMetadata = JSON.parse(orderRequest.purchase_units[0].custom_id);
        expect(parsedMetadata.attempt).toBe('1');
        expect(parsedMetadata.nullable).toBe('');
    });

    it('fails to create order when PayPal rejects the request', async () => {
        const { service } = createService();

        fetchMock
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ access_token: 'token' }),
            })
            .mockResolvedValueOnce({
                ok: false,
                status: 400,
                text: () => Promise.resolve('bad request'),
            });

        await expect(service.createOrder(ctx, order)).rejects.toThrow('Failed to create PayPal order');
    });

    it('verifies webhook signatures successfully', async () => {
        const { service } = createService();
        const headers: PaypalWebhookHeaders = {
            transmissionId: '1',
            transmissionTime: 'time',
            transmissionSig: 'sig',
            certUrl: 'url',
            authAlgo: 'algo',
            webhookId: 'ignored',
        };
        const event: PaypalWebhookEvent = {
            id: 'event',
            event_type: 'PAYMENT.CAPTURE.COMPLETED',
            resource: { id: 'resource' },
        } as PaypalWebhookEvent;

        fetchMock
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ access_token: 'token' }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ verification_status: 'SUCCESS' }),
            });

        await expect(service.verifyWebhookSignature(ctx, headers, event, order)).resolves.toBe(true);
    });

    it('returns false when webhook verification fails', async () => {
        const { service } = createService();
        const headers: PaypalWebhookHeaders = {
            transmissionId: '1',
            transmissionTime: 'time',
            transmissionSig: 'sig',
            certUrl: 'url',
            authAlgo: 'algo',
            webhookId: 'ignored',
        };
        const event: PaypalWebhookEvent = {
            id: 'event',
            event_type: 'PAYMENT.CAPTURE.COMPLETED',
            resource: { id: 'resource' },
        } as PaypalWebhookEvent;
        const loggerSpy = vi.spyOn(Logger, 'error').mockReturnValue(undefined);

        fetchMock
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ access_token: 'token' }),
            })
            .mockResolvedValueOnce({
                ok: false,
                status: 403,
                text: () => Promise.resolve('forbidden'),
            });

        await expect(service.verifyWebhookSignature(ctx, headers, event, order)).resolves.toBe(false);
        expect(loggerSpy).toHaveBeenCalledOnce();
        loggerSpy.mockRestore();
    });

    it('creates refunds for captures', async () => {
        const { service } = createService();
        const payment = {
            metadata: {
                paypalCaptureId: 'capture',
            },
        } as Payment;

        fetchMock
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ access_token: 'token' }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ status: 'COMPLETED' }),
            });

        const refund = await service.refundCapture(ctx, order, payment, 4321);
        expect(refund).toEqual({ status: 'COMPLETED' });

        const refundRequest = JSON.parse(fetchMock.mock.calls[1][1].body as string);
        expect(refundRequest.amount.value).toBe('43.21');
    });

    it('throws when capture id is missing', async () => {
        const { service } = createService();
        const payment = { metadata: {} } as Payment;
        fetchMock.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ access_token: 'token' }),
        });
        await expect(service.refundCapture(ctx, order, payment, 100)).rejects.toThrow(
            'PayPal payment is missing capture id',
        );
    });

    it('converts amounts using utility helpers', () => {
        const { service } = createService();
        expect(service.convertAmountToMinorUnits(order, '10.55')).toBe(1055);
    });

    it('throws when PayPal authentication fails', async () => {
        const { service } = createService();

        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 401,
            text: () => Promise.resolve('unauthorized'),
        });

        await expect(
            (service as any).fetchAccessToken({
                clientId: 'id',
                clientSecret: 'secret',
                webhookId: 'webhook',
            }),
        ).rejects.toThrow('Failed to authenticate with PayPal');
    });

    it('throws when access token is missing from authentication response', async () => {
        const { service } = createService();

        fetchMock.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({}),
        });

        await expect(
            (service as any).fetchAccessToken({
                clientId: 'id',
                clientSecret: 'secret',
                webhookId: 'webhook',
            }),
        ).rejects.toThrow('PayPal authentication response missing access token');
    });

    it('retrieves PayPal credentials from payment method', async () => {
        const { service, paymentMethod } = createService();
        const credentials = await (service as any).getPaypalCredentials(ctx, order);
        expect(credentials).toEqual({ clientId: 'client', clientSecret: 'secret', webhookId: 'webhook' });

        paymentMethod.handler.args = paymentMethod.handler.args.filter(arg => arg.name !== 'webhookId');
        await expect((service as any).getPaypalCredentials(ctx, order)).rejects.toThrow(
            "No argument named 'webhookId' found on PayPal handler",
        );
    });

    it('throws when PayPal payment method is unavailable or ineligible', async () => {
        const { service: missingMethodService } = createService({}, { includeMethod: false });
        await expect((missingMethodService as any).getPaypalCredentials(ctx, order)).rejects.toThrow(
            'No enabled PayPal payment method found',
        );

        const { service: ineligibleService } = createService({}, { eligible: [] });
        await expect((ineligibleService as any).getPaypalCredentials(ctx, order)).rejects.toThrow(
            `PayPal payment method is not eligible for order ${String(order.code)}`,
        );
    });
});
