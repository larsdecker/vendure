import {
    CreatePaymentResult,
    CreateRefundResult,
    Injector,
    LanguageCode,
    PaymentMethodHandler,
    SettlePaymentResult,
} from '@vendure/core';

import { PaypalService } from './paypal.service';

let paypalService: PaypalService;

export const paypalPaymentMethodHandler = new PaymentMethodHandler({
    code: 'paypal',
    description: [{ languageCode: LanguageCode.en, value: 'PayPal payments' }],
    args: {
        clientId: {
            type: 'string',
            label: [{ languageCode: LanguageCode.en, value: 'Client ID' }],
        },
        clientSecret: {
            type: 'string',
            label: [{ languageCode: LanguageCode.en, value: 'Client secret' }],
            ui: { component: 'password-form-input' },
        },
        webhookId: {
            type: 'string',
            label: [{ languageCode: LanguageCode.en, value: 'Webhook ID' }],
        },
    },
    init(injector: Injector) {
        paypalService = injector.get(PaypalService);
    },
    createPayment(ctx, order, _amount, _method, metadata): CreatePaymentResult {
        if (ctx.apiType !== 'admin') {
            throw Error(`CreatePayment is not allowed for apiType '${ctx.apiType}'`);
        }
        const captureAmount = metadata?.paypalCaptureAmountValue as string | undefined;
        if (!captureAmount) {
            throw Error('PayPal capture amount missing from metadata');
        }
        const amountInMinorUnits = paypalService.convertAmountToMinorUnits(order, captureAmount);
        const transactionId =
            (metadata?.paypalCaptureId as string | undefined) ??
            (metadata?.paypalOrderId as string | undefined);
        if (!transactionId) {
            throw Error('PayPal metadata is missing capture or order identifier');
        }
        return {
            amount: amountInMinorUnits,
            state: 'Settled' as const,
            transactionId,
            metadata,
        };
    },
    settlePayment(): SettlePaymentResult {
        return { success: true };
    },
    async createRefund(ctx, input, amount, order, payment): Promise<CreateRefundResult> {
        try {
            const refund = await paypalService.refundCapture(ctx, order, payment, amount);
            if (refund.status === 'COMPLETED') {
                return { state: 'Settled' as const, transactionId: payment.transactionId };
            }
            if (refund.status === 'PENDING') {
                return { state: 'Pending' as const, transactionId: payment.transactionId };
            }
            return {
                state: 'Failed' as const,
                transactionId: payment.transactionId,
                metadata: {
                    status: refund.status ?? 'UNKNOWN',
                },
            };
        } catch (error: any) {
            return {
                state: 'Failed' as const,
                transactionId: payment.transactionId,
                metadata: {
                    message: (error as Error).message,
                },
            };
        }
    },
});
