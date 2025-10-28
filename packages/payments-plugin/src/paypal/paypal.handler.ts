import {
    CreatePaymentErrorResult,
    CreatePaymentResult,
    CreateRefundResult,
    Injector,
    LanguageCode,
    Logger,
    PaymentMetadata,
    PaymentMethodHandler,
    SettlePaymentErrorResult,
    SettlePaymentResult,
} from '@vendure/core';

import { PaypalService, loggerCtx } from './paypal.service';
import { PaypalHandlerArgs, PaypalPaymentMetadata } from './types';

let paypalService: PaypalService;

function resolveArgs(handlerArgs: Record<string, unknown> | undefined): PaypalHandlerArgs {
    return {
        clientId: typeof handlerArgs?.clientId === 'string' ? handlerArgs.clientId : undefined,
        clientSecret: typeof handlerArgs?.clientSecret === 'string' ? handlerArgs.clientSecret : undefined,
        mode: (handlerArgs?.mode as PaypalHandlerArgs['mode']) ?? 'sandbox',
        intent: (handlerArgs?.intent as PaypalHandlerArgs['intent']) ?? 'capture',
        currency: typeof handlerArgs?.currency === 'string' ? handlerArgs.currency.toUpperCase() : 'EUR',
        brandName:
            typeof handlerArgs?.brandName === 'string' && handlerArgs.brandName.length
                ? handlerArgs.brandName
                : undefined,
        locale:
            typeof handlerArgs?.locale === 'string' && handlerArgs.locale.length
                ? handlerArgs.locale
                : undefined,
    };
}

function readMetadata(metadata: PaymentMetadata): PaypalPaymentMetadata {
    const paypalMetadata = metadata as PaypalPaymentMetadata;
    if (!paypalMetadata?.paypalOrderId) {
        throw new Error('PayPal metadata must include the paypalOrderId.');
    }
    return paypalMetadata;
}

export const paypalPaymentMethodHandler = new PaymentMethodHandler({
    code: 'paypal',
    description: [{ languageCode: LanguageCode.en, value: 'PayPal payments' }],
    args: {
        clientId: {
            type: 'string',
            label: [{ languageCode: LanguageCode.en, value: 'Client ID' }],
            ui: { component: 'password-form-input' },
        },
        clientSecret: {
            type: 'string',
            label: [{ languageCode: LanguageCode.en, value: 'Client Secret' }],
            ui: { component: 'password-form-input' },
        },
        mode: {
            type: 'string',
            label: [{ languageCode: LanguageCode.en, value: 'Environment' }],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value: 'Use sandbox for testing and live for production payments.',
                },
            ],
            defaultValue: 'sandbox',
            ui: {
                component: 'select-form-input',
                options: [
                    { value: 'sandbox', label: [{ languageCode: LanguageCode.en, value: 'Sandbox' }] },
                    { value: 'live', label: [{ languageCode: LanguageCode.en, value: 'Live' }] },
                ],
            },
        },
        intent: {
            type: 'string',
            label: [{ languageCode: LanguageCode.en, value: 'Payment intent' }],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value: 'Capture completes the payment immediately. Authorize defers capture until manually settled.',
                },
            ],
            defaultValue: 'capture',
            ui: {
                component: 'select-form-input',
                options: [
                    { value: 'capture', label: [{ languageCode: LanguageCode.en, value: 'Capture' }] },
                    { value: 'authorize', label: [{ languageCode: LanguageCode.en, value: 'Authorize' }] },
                ],
            },
        },
        currency: {
            type: 'string',
            label: [{ languageCode: LanguageCode.en, value: 'Currency' }],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value: '3-letter ISO currency code expected by PayPal. Must match the channel currency.',
                },
            ],
            defaultValue: 'EUR',
        },
        brandName: {
            type: 'string',
            label: [{ languageCode: LanguageCode.en, value: 'Brand name' }],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value: 'Optional brand name shown on the PayPal approval page.',
                },
            ],
        },
        locale: {
            type: 'string',
            label: [{ languageCode: LanguageCode.en, value: 'Locale override' }],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value: 'Optional locale passed to PayPal application context (e.g. en-GB).',
                },
            ],
        },
    },
    init(injector: Injector) {
        paypalService = injector.get(PaypalService);
    },
    async createPayment(
        ctx,
        order,
        amountMinor,
        handlerArgs,
        _metadata,
        _method,
    ): Promise<CreatePaymentResult | CreatePaymentErrorResult> {
        try {
            const args = resolveArgs(handlerArgs);
            const config = paypalService.resolveConfig(args);
            if (typeof amountMinor === 'number' && amountMinor !== order.totalWithTax) {
                const message = `PayPal payment amount ${String(amountMinor)} does not match order total ${String(order.totalWithTax)}.`;
                Logger.warn(message, loggerCtx);
                return {
                    amount: amountMinor,
                    state: 'Declined',
                    errorMessage: message,
                    metadata: { error: message },
                };
            }
            if (order.currencyCode !== config.currencyCode) {
                const message = [
                    `Currency mismatch: order ${String(order.code)} uses ${String(order.currencyCode)}`,
                    `but PayPal handler is configured for ${String(config.currencyCode)}.`,
                ].join(' ');
                Logger.warn(message, loggerCtx);
                return {
                    amount: order.totalWithTax,
                    state: 'Declined',
                    errorMessage: message,
                    metadata: { error: message },
                };
            }
            const amount = paypalService.formatAmount(order.totalWithTax, config.currencyCode);
            const result = await paypalService.createOrder(ctx, order, args, {
                intent: config.intent,
                amount,
                currencyCode: config.currencyCode,
                returnUrl: _metadata?.returnUrl,
                cancelUrl: _metadata?.cancelUrl,
                brandName: config.brandName,
                locale: config.locale,
                orderCode: order.code,
            });
            const metadata: PaypalPaymentMetadata = {
                paypalOrderId: result.id,
                intent: result.intent,
                currencyCode: config.currencyCode,
                public: {
                    approvalUrl: result.approvalUrl,
                },
            };
            return {
                amount: order.totalWithTax,
                state: 'Authorized',
                transactionId: result.id,
                metadata,
            };
        } catch (err: any) {
            Logger.error(err instanceof Error ? err.message : 'Failed to create PayPal order.', loggerCtx);
            return {
                amount: order.totalWithTax,
                state: 'Declined',
                errorMessage: err instanceof Error ? err.message : 'Failed to create PayPal order.',
                metadata: {
                    error: err instanceof Error ? err.message : undefined,
                },
            };
        }
    },
    async settlePayment(
        ctx,
        order,
        payment,
        handlerArgs,
    ): Promise<SettlePaymentResult | SettlePaymentErrorResult> {
        try {
            const args = resolveArgs(handlerArgs);
            const config = paypalService.resolveConfig(args);
            const metadata = { ...readMetadata(payment.metadata ?? {}) };
            if (metadata.currencyCode && metadata.currencyCode !== config.currencyCode) {
                return {
                    success: false,
                    errorMessage: `Stored currency ${String(metadata.currencyCode)} does not match configured currency ${String(config.currencyCode)}.`,
                };
            }
            if (metadata.captureId) {
                return { success: true };
            }
            let capture;
            if (metadata.intent === 'AUTHORIZE') {
                let authorizationId = metadata.authorizationId;
                if (!authorizationId) {
                    const authorization = await paypalService.authorizeOrder(args, metadata.paypalOrderId);
                    authorizationId = authorization.id;
                    metadata.authorizationId = authorizationId;
                }
                capture = await paypalService.captureAuthorization(args, authorizationId);
            } else {
                capture = await paypalService.captureOrder(args, metadata.paypalOrderId);
            }
            const amountMinor = paypalService.toMinorUnit(capture.amount.value, capture.amount.currency_code);
            const expectedAmount = typeof payment.amount === 'number' ? payment.amount : order.totalWithTax;
            if (amountMinor !== expectedAmount) {
                return {
                    success: false,
                    errorMessage: `Captured amount ${String(amountMinor)} does not match expected amount ${String(expectedAmount)}.`,
                };
            }
            if (capture.amount.currency_code !== order.currencyCode) {
                return {
                    success: false,
                    errorMessage: `Captured currency ${String(capture.amount.currency_code)} does not match order currency ${String(order.currencyCode)}.`,
                };
            }
            payment.transactionId = capture.id;
            payment.metadata = {
                ...metadata,
                captureId: capture.id,
                payerEmail: capture.payer?.email_address,
                currencyCode: order.currencyCode,
            } as PaymentMetadata;
            return { success: true };
        } catch (err: any) {
            Logger.error(err instanceof Error ? err.message : 'Failed to capture PayPal order.', loggerCtx);
            return {
                success: false,
                errorMessage: err instanceof Error ? err.message : 'Failed to capture PayPal order.',
            };
        }
    },
    async createRefund(ctx, input, amount, order, payment, handlerArgs): Promise<CreateRefundResult> {
        try {
            const args = resolveArgs(handlerArgs);
            const metadata = readMetadata(payment.metadata ?? {});
            const captureId = metadata.captureId ?? payment.transactionId;
            if (!captureId) {
                return {
                    state: 'Failed',
                    metadata: { message: 'Cannot refund without a captured transaction.' },
                };
            }
            const config = paypalService.resolveConfig(args);
            if (metadata.currencyCode && metadata.currencyCode !== config.currencyCode) {
                return {
                    state: 'Failed',
                    metadata: {
                        message: `Stored currency ${String(metadata.currencyCode)} does not match configured currency ${String(config.currencyCode)}.`,
                    },
                };
            }
            const formattedAmount = paypalService.formatAmount(amount, config.currencyCode);
            const refund = await paypalService.refundCapture(
                args,
                captureId,
                formattedAmount,
                config.currencyCode,
            );
            if (refund.status !== 'COMPLETED') {
                return {
                    state: 'Failed',
                    transactionId: captureId,
                    metadata: { status: refund.status },
                };
            }
            return {
                state: 'Settled',
                transactionId: refund.id,
                metadata: {
                    paypalOrderId: metadata.paypalOrderId,
                    captureId,
                    refundAmount: formattedAmount,
                },
            };
        } catch (err: any) {
            Logger.error(err instanceof Error ? err.message : 'Failed to refund PayPal capture.', loggerCtx);
            return {
                state: 'Failed',
                metadata: { errorMessage: err instanceof Error ? err.message : 'Failed to refund capture.' },
            };
        }
    },
    async cancelPayment(ctx, order, payment, handlerArgs) {
        try {
            const args = resolveArgs(handlerArgs);
            const metadata = readMetadata(payment.metadata ?? {});
            if (metadata.intent !== 'AUTHORIZE') {
                return { success: true };
            }
            const authorizationId = metadata.authorizationId;
            if (!authorizationId) {
                Logger.warn(
                    `Attempted to cancel PayPal payment ${String(payment.id)} but no authorization id was stored.`,
                    loggerCtx,
                );
                return { success: true };
            }
            await paypalService.voidAuthorization(args, authorizationId);
            return { success: true };
        } catch (err: any) {
            Logger.error(
                err instanceof Error ? err.message : 'Failed to cancel PayPal authorization.',
                loggerCtx,
            );
            return {
                success: false,
                errorMessage: err instanceof Error ? err.message : 'Failed to cancel PayPal authorization.',
            };
        }
    },
});
