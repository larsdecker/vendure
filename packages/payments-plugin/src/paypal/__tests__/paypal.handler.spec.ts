import { describe, expect, it, beforeEach, vi } from 'vitest';

vi.mock('@vendure/core', () => {
    const logger = {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        verbose: vi.fn(),
    };
    class PaymentMethodHandler<T = any> {
        code: string;
        description: any;
        args: any;
        init?: (injector: { get: <K>(token: any) => K }) => void;
        createPayment?: any;
        settlePayment?: any;
        createRefund?: any;
        cancelPayment?: any;
        constructor(options: any) {
            Object.assign(this, options);
        }
    }
    return {
        Logger: logger,
        LanguageCode: { en: 'en' },
        PaymentMethodHandler,
    };
});

import { paypalPaymentMethodHandler } from '../paypal.handler';
import { PaypalService } from '../paypal.service';
import { PaypalResolvedConfig } from '../types';

function createMockService() {
    return {
        resolveConfig: vi.fn(),
        formatAmount: vi.fn(),
        createOrder: vi.fn(),
        captureOrder: vi.fn(),
        authorizeOrder: vi.fn(),
        captureAuthorization: vi.fn(),
        toMinorUnit: vi.fn(),
        refundCapture: vi.fn(),
        voidAuthorization: vi.fn(),
    } as unknown as PaypalService;
}

describe('paypalPaymentMethodHandler', () => {
    let mockService: PaypalService;
    const baseConfig: PaypalResolvedConfig = {
        clientId: 'id',
        clientSecret: 'secret',
        mode: 'sandbox',
        intent: 'capture',
        currencyCode: 'EUR',
        brandName: undefined,
        locale: undefined,
    };

    beforeEach(() => {
        mockService = createMockService();
        (mockService.resolveConfig as any).mockReturnValue(baseConfig);
        (mockService.formatAmount as any).mockReturnValue('123.45');
        (mockService.toMinorUnit as any).mockReturnValue(12345);
        paypalPaymentMethodHandler.init({ get: () => mockService } as any);
    });

    it('creates a payment and stores metadata', async () => {
        (mockService.createOrder as any).mockResolvedValue({
            id: 'ORDER123',
            status: 'CREATED',
            intent: 'CAPTURE',
            approvalUrl: 'https://paypal.test/approve',
        });
        const result = await paypalPaymentMethodHandler.createPayment(
            { apiType: 'shop' } as any,
            { totalWithTax: 12345, currencyCode: 'EUR', code: 'T100' } as any,
            12345,
            { currency: 'EUR', intent: 'capture' },
            {},
            {} as any,
        );
        expect(result.state).toBe('Authorized');
        expect(result.transactionId).toBe('ORDER123');
        expect(result.metadata).toMatchObject({
            paypalOrderId: 'ORDER123',
            currencyCode: 'EUR',
            public: { approvalUrl: 'https://paypal.test/approve' },
        });
    });

    it('declines the payment when PayPal order creation fails', async () => {
        (mockService.createOrder as any).mockRejectedValue(new Error('failed'));
        const result = await paypalPaymentMethodHandler.createPayment(
            { apiType: 'shop' } as any,
            { totalWithTax: 12345, currencyCode: 'EUR', code: 'T100' } as any,
            12345,
            { currency: 'EUR' },
            {},
            {} as any,
        );
        expect(result.state).toBe('Declined');
        expect(result.errorMessage).toContain('failed');
    });

    it('captures a payment in capture mode', async () => {
        (mockService.captureOrder as any).mockResolvedValue({
            id: 'CAPTURE123',
            status: 'COMPLETED',
            amount: { currency_code: 'EUR', value: '123.45' },
            payer: { email_address: 'payer@example.com' },
        });
        const payment: any = {
            metadata: {
                paypalOrderId: 'ORDER123',
                intent: 'CAPTURE',
                currencyCode: 'EUR',
            },
        };
        const result = await paypalPaymentMethodHandler.settlePayment(
            {} as any,
            { totalWithTax: 12345, currencyCode: 'EUR' } as any,
            payment,
            { currency: 'EUR' },
        );
        expect(result).toEqual({ success: true });
        expect(payment.transactionId).toBe('CAPTURE123');
        expect(payment.metadata.captureId).toBe('CAPTURE123');
        expect(payment.metadata.payerEmail).toBe('payer@example.com');
    });

    it('authorizes and captures when authorization id is missing', async () => {
        (mockService.resolveConfig as any).mockReturnValue({ ...baseConfig, intent: 'authorize' });
        (mockService.authorizeOrder as any).mockResolvedValue({
            id: 'AUTH1',
            status: 'CREATED',
            amount: { currency_code: 'EUR', value: '123.45' },
        });
        (mockService.captureAuthorization as any).mockResolvedValue({
            id: 'CAPTUREAUTH',
            status: 'COMPLETED',
            amount: { currency_code: 'EUR', value: '123.45' },
        });
        const payment: any = {
            metadata: {
                paypalOrderId: 'ORDER123',
                intent: 'AUTHORIZE',
                currencyCode: 'EUR',
            },
        };
        const result = await paypalPaymentMethodHandler.settlePayment(
            {} as any,
            { totalWithTax: 12345, currencyCode: 'EUR' } as any,
            payment,
            { currency: 'EUR', intent: 'authorize' },
        );
        expect(result).toEqual({ success: true });
        expect(payment.metadata.authorizationId).toBe('AUTH1');
        expect(payment.metadata.captureId).toBe('CAPTUREAUTH');
    });

    it('returns an error when captured amount mismatches order total', async () => {
        (mockService.captureOrder as any).mockResolvedValue({
            id: 'CAPTURE123',
            status: 'COMPLETED',
            amount: { currency_code: 'EUR', value: '120.00' },
        });
        (mockService.toMinorUnit as any).mockReturnValue(12000);
        const payment: any = {
            metadata: {
                paypalOrderId: 'ORDER123',
                intent: 'CAPTURE',
                currencyCode: 'EUR',
            },
        };
        const result = await paypalPaymentMethodHandler.settlePayment(
            {} as any,
            { totalWithTax: 12345, currencyCode: 'EUR' } as any,
            payment,
            { currency: 'EUR' },
        );
        expect(result.success).toBe(false);
        expect(result.errorMessage).toContain('Captured amount');
    });

    it('creates refunds when capture metadata is present', async () => {
        (mockService.formatAmount as any).mockReturnValue('12.34');
        (mockService.refundCapture as any).mockResolvedValue({
            id: 'REFUND1',
            status: 'COMPLETED',
        });
        const payment: any = {
            metadata: {
                paypalOrderId: 'ORDER123',
                captureId: 'CAPTURE123',
                intent: 'CAPTURE',
                currencyCode: 'EUR',
            },
        };
        const result = await paypalPaymentMethodHandler.createRefund(
            {} as any,
            {} as any,
            1234,
            { currencyCode: 'EUR' } as any,
            payment,
            { currency: 'EUR' },
        );
        expect(result.state).toBe('Settled');
        expect(result.transactionId).toBe('REFUND1');
    });

    it('fails refund when capture id is missing', async () => {
        const payment: any = {
            metadata: {
                paypalOrderId: 'ORDER123',
                intent: 'CAPTURE',
                currencyCode: 'EUR',
            },
        };
        const result = await paypalPaymentMethodHandler.createRefund(
            {} as any,
            {} as any,
            1234,
            { currencyCode: 'EUR' } as any,
            payment,
            { currency: 'EUR' },
        );
        expect(result.state).toBe('Failed');
    });
});
