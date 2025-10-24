import { LanguageCode } from '@vendure/common/lib/generated-types';
import {
    CreatePaymentErrorResult,
    CreatePaymentResult,
    CreateRefundResult,
    Injector,
    Logger,
    PaymentMethodHandler,
    RequestContext,
    SettlePaymentErrorResult,
    SettlePaymentResult,
} from '@vendure/core';

import { PaypalService, loggerCtx } from './services/paypal.service';
import { PaypalHandlerConfig, PaypalMode, PaypalPaymentMetadata } from './types/paypal-types';

let paypalService: PaypalService;

function getConfig(args: Record<string, unknown> | undefined): PaypalHandlerConfig {
    const mode = (typeof args?.mode === 'string' ? args.mode : 'sandbox') as PaypalMode;
    const captureImmediately = args?.captureImmediately === true || args?.captureImmediately === 'true';
    const clientId =
        typeof args?.clientId === 'string' && args.clientId.length ? (args.clientId as string) : undefined;
    const clientSecret =
        typeof args?.clientSecret === 'string' && args.clientSecret.length
            ? (args.clientSecret as string)
            : undefined;
    return {
        clientId,
        clientSecret,
        mode,
        captureImmediately,
    };
}

function toMetadata(metadata: unknown): PaypalPaymentMetadata {
    const value = metadata as PaypalPaymentMetadata | undefined;
    if (!value?.paypalOrderId) {
        throw new Error('PayPal metadata is missing the paypalOrderId property.');
    }
    return value;
}

function assertConfig(_ctx: RequestContext, config: PaypalHandlerConfig): void {
    try {
        paypalService.ensureCredentials(config);
    } catch (err: any) {
        Logger.error(err.message, loggerCtx);
        throw err;
    }
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
            label: [{ languageCode: LanguageCode.en, value: 'Mode' }],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value: 'Choose between the PayPal sandbox and live environments.',
                },
            ],
            defaultValue: 'sandbox',
        },
        captureImmediately: {
            type: 'boolean',
            label: [
                {
                    languageCode: LanguageCode.en,
                    value: 'Capture payment immediately',
                },
            ],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value: 'When disabled, payments must be captured manually from the Admin UI.',
                },
            ],
            defaultValue: false,
        },
    },
    init(injector: Injector) {
        paypalService = injector.get(PaypalService);
    },
    async createPayment(
        ctx,
        order,
        amount,
        handlerArgs,
        metadata,
    ): Promise<CreatePaymentResult | CreatePaymentErrorResult> {
        if (ctx.apiType !== 'admin' && ctx.apiType !== 'shop' && ctx.apiType !== 'custom') {
            throw new Error(`CreatePayment is not allowed for apiType '${ctx.apiType}'`);
        }
        const config = getConfig(handlerArgs);
        assertConfig(ctx, config);
        const paypalMetadata = toMetadata(metadata);
        try {
            if (config.captureImmediately) {
                const capture = await paypalService.captureOrder(ctx, order, config, paypalMetadata);
                if (capture.status !== 'COMPLETED') {
                    return {
                        amount,
                        state: 'Declined',
                        transactionId: capture.id,
                        metadata: { status: capture.status },
                        errorMessage: 'PayPal capture did not complete successfully.',
                    };
                }
                const minorUnits = paypalService.toMinorUnit(
                    capture.amount.value,
                    capture.amount.currency_code,
                );
                return {
                    amount: minorUnits,
                    state: 'Settled',
                    transactionId: capture.id,
                    metadata: {
                        ...paypalMetadata,
                        captureId: capture.id,
                        intent: 'CAPTURE',
                    },
                };
            }
            const authorization = await paypalService.authorizeOrder(
                ctx,
                order,
                config,
                paypalMetadata,
            );
            if (authorization.status !== 'CREATED' && authorization.status !== 'COMPLETED') {
                return {
                    amount,
                    state: 'Declined',
                    transactionId: authorization.id,
                    metadata: { status: authorization.status },
                    errorMessage: 'PayPal authorization was not approved.',
                };
            }
            const minorUnits = paypalService.toMinorUnit(
                authorization.amount.value,
                authorization.amount.currency_code,
            );
            return {
                amount: minorUnits,
                state: 'Authorized',
                transactionId: authorization.id,
                metadata: {
                    ...paypalMetadata,
                    authorizationId: authorization.id,
                    intent: 'AUTHORIZE',
                },
            };
        } catch (err: any) {
            Logger.error(err.message, loggerCtx);
            return {
                amount,
                state: 'Error',
                transactionId: '',
                errorMessage: err.message,
                metadata: { paypalOrderId: paypalMetadata.paypalOrderId },
            };
        }
    },
    async settlePayment(
        ctx,
        order,
        payment,
        handlerArgs,
    ): Promise<SettlePaymentResult | SettlePaymentErrorResult> {
        const config = getConfig(handlerArgs);
        assertConfig(ctx, config);
        const metadata = toMetadata(payment.metadata);
        if (!metadata.authorizationId) {
            Logger.warn(
                `Attempted to settle PayPal payment ${payment.id} but no authorization id was found in the metadata.`,
                loggerCtx,
            );
            return { success: true };
        }
        const capture = await paypalService.captureAuthorization(
            config,
            metadata.authorizationId,
            order.currencyCode,
        );
        if (capture.status !== 'COMPLETED') {
            return {
                success: false,
                errorMessage: `PayPal capture ${capture.id} returned status ${capture.status}`,
            };
        }
        payment.transactionId = capture.id;
        payment.metadata = {
            ...metadata,
            captureId: capture.id,
            intent: 'CAPTURE',
        };
        return { success: true };
    },
    async createRefund(ctx, input, amount, order, payment, handlerArgs): Promise<CreateRefundResult> {
        const config = getConfig(handlerArgs);
        assertConfig(ctx, config);
        const metadata = toMetadata(payment.metadata);
        const captureId = metadata.captureId ?? payment.transactionId;
        if (!captureId) {
            return {
                state: 'Failed',
                transactionId: payment.transactionId,
                metadata: { reason: 'Missing capture identifier for refund.' },
            };
        }
        try {
            const refund = await paypalService.refundCapture(
                config,
                captureId,
                amount,
                order.currencyCode,
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
                transactionId: captureId,
                metadata: { refundId: refund.id },
            };
        } catch (err: any) {
            Logger.error(err.message, loggerCtx);
            return {
                state: 'Failed',
                transactionId: captureId,
                metadata: { error: err.message },
            };
        }
    },
});
