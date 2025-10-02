import { Inject, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ConfigArg } from '@vendure/common/lib/generated-types';
import {
    Injector,
    Logger,
    Order,
    Payment,
    PaymentMethodService,
    RequestContext,
    UserInputError,
} from '@vendure/core';
import fetch from 'node-fetch';

import { loggerCtx, PAYPAL_PLUGIN_OPTIONS } from './constants';
import {
    convertPaypalAmountToMinorUnits,
    createPaypalMetadata,
    formatMinorUnitAmount,
    formatPaypalAmount,
    getPaypalApiBase,
} from './paypal-utils';
import { paypalPaymentMethodHandler } from './paypal.handler';
import { PaypalOrderResponse, PaypalPluginOptions, PaypalWebhookEvent, PaypalWebhookHeaders } from './types';

interface PaypalCredentials {
    clientId: string;
    clientSecret: string;
    webhookId: string;
}

interface PaypalVerifyResponse {
    verification_status: 'SUCCESS' | 'FAILURE' | 'WARNING';
}

interface PaypalRefundResponse {
    status?: string;
}

@Injectable()
export class PaypalService {
    constructor(
        @Inject(PAYPAL_PLUGIN_OPTIONS) private options: PaypalPluginOptions,
        private paymentMethodService: PaymentMethodService,
        private moduleRef: ModuleRef,
    ) {}

    async createOrder(ctx: RequestContext, order: Order): Promise<PaypalOrderResponse> {
        const credentials = await this.getPaypalCredentials(ctx, order);
        const accessToken = await this.fetchAccessToken(credentials);

        const injector = new Injector(this.moduleRef);
        const additionalMetadata =
            typeof this.options.metadata === 'function'
                ? await this.options.metadata(injector, ctx, order)
                : {};
        const { serialized } = createPaypalMetadata(
            order,
            ctx.channel.token,
            ctx.languageCode,
            mapRecordToString(additionalMetadata ?? {}),
        );

        const defaultPurchaseUnit = {
            amount: {
                currency_code: order.currencyCode,
                value: formatPaypalAmount(order),
            },
            reference_id: order.code,
            custom_id: serialized,
        };

        const purchaseUnit = this.options.purchaseUnit
            ? await this.options.purchaseUnit(injector, ctx, order, defaultPurchaseUnit)
            : defaultPurchaseUnit;

        const body: Record<string, unknown> = {
            intent: this.options.intent ?? 'CAPTURE',
            purchase_units: [purchaseUnit],
        };

        if (this.options.applicationContext) {
            body.application_context = await this.options.applicationContext(injector, ctx, order);
        }

        const response = await fetch(`${getPaypalApiBase(this.options.environment)}/v2/checkout/orders`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const message = await response.text();
            Logger.error(
                `Failed to create PayPal order for ${order.code}: ${response.status} ${message}`,
                loggerCtx,
            );
            throw Error('Failed to create PayPal order');
        }

        return (await response.json()) as PaypalOrderResponse;
    }

    async verifyWebhookSignature(
        ctx: RequestContext,
        headers: PaypalWebhookHeaders,
        event: PaypalWebhookEvent,
        order: Order,
    ): Promise<boolean> {
        const credentials = await this.getPaypalCredentials(ctx, order);
        const accessToken = await this.fetchAccessToken(credentials);

        const response = await fetch(
            `${getPaypalApiBase(this.options.environment)}/v1/notifications/verify-webhook-signature`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    auth_algo: headers.authAlgo,
                    cert_url: headers.certUrl,
                    transmission_id: headers.transmissionId,
                    transmission_sig: headers.transmissionSig,
                    transmission_time: headers.transmissionTime,
                    webhook_id: credentials.webhookId,
                    webhook_event: event,
                }),
            },
        );

        if (!response.ok) {
            const message = await response.text();
            Logger.error(
                `Failed to verify PayPal webhook signature: ${response.status} ${message}`,
                loggerCtx,
            );
            return false;
        }

        const payload = (await response.json()) as PaypalVerifyResponse;
        return payload.verification_status === 'SUCCESS';
    }

    async refundCapture(
        ctx: RequestContext,
        order: Order,
        payment: Payment,
        amount: number,
    ): Promise<PaypalRefundResponse> {
        const credentials = await this.getPaypalCredentials(ctx, order);
        const accessToken = await this.fetchAccessToken(credentials);
        const captureId = payment.metadata?.paypalCaptureId as string | undefined;
        if (!captureId) {
            throw new UserInputError('PayPal payment is missing capture id');
        }

        const response = await fetch(
            `${getPaypalApiBase(this.options.environment)}/v2/payments/captures/${captureId}/refund`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    amount: {
                        currency_code: order.currencyCode,
                        value: formatMinorUnitAmount(amount, order.currencyCode),
                    },
                }),
            },
        );

        if (!response.ok) {
            const message = await response.text();
            Logger.error(
                `Failed to create PayPal refund for ${order.code}: ${response.status} ${message}`,
                loggerCtx,
            );
            throw Error('Failed to create PayPal refund');
        }

        return (await response.json()) as PaypalRefundResponse;
    }

    convertAmountToMinorUnits(order: Order, amount: string): number {
        return convertPaypalAmountToMinorUnits(amount, order.currencyCode);
    }

    private async fetchAccessToken(credentials: PaypalCredentials): Promise<string> {
        const response = await fetch(`${getPaypalApiBase(this.options.environment)}/v1/oauth2/token`, {
            method: 'POST',
            headers: {
                Authorization: `Basic ${Buffer.from(
                    `${credentials.clientId}:${credentials.clientSecret}`,
                ).toString('base64')}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: 'grant_type=client_credentials',
        });

        if (!response.ok) {
            const message = await response.text();
            Logger.error(`Failed to fetch PayPal access token: ${response.status} ${message}`, loggerCtx);
            throw Error('Failed to authenticate with PayPal');
        }

        const json = (await response.json()) as { access_token?: string };
        if (!json.access_token) {
            throw Error('PayPal authentication response missing access token');
        }
        return json.access_token;
    }

    private async getPaypalCredentials(ctx: RequestContext, order: Order): Promise<PaypalCredentials> {
        const [eligiblePaymentMethods, paymentMethods] = await Promise.all([
            this.paymentMethodService.getEligiblePaymentMethods(ctx, order),
            this.paymentMethodService.findAll(ctx, {
                filter: {
                    enabled: { eq: true },
                },
            }),
        ]);

        const paypalMethod = paymentMethods.items.find(
            pm => pm.handler.code === paypalPaymentMethodHandler.code,
        );
        if (!paypalMethod) {
            throw new UserInputError('No enabled PayPal payment method found');
        }

        const isEligible = eligiblePaymentMethods.some(pm => pm.code === paypalMethod.code);
        if (!isEligible) {
            throw new UserInputError(`PayPal payment method is not eligible for order ${order.code}`);
        }

        const clientId = this.findArgValue(paypalMethod.handler.args, 'clientId');
        const clientSecret = this.findArgValue(paypalMethod.handler.args, 'clientSecret');
        const webhookId = this.findArgValue(paypalMethod.handler.args, 'webhookId');

        return { clientId, clientSecret, webhookId };
    }

    private findArgValue(args: ConfigArg[], name: string): string {
        const value = args.find(arg => arg.name === name)?.value;
        if (!value) {
            throw Error(`No argument named '${name}' found on PayPal handler`);
        }
        return value;
    }
}

function mapRecordToString(input: Record<string, unknown>): Record<string, string> {
    return Object.fromEntries(
        Object.entries(input).map(([key, value]) => [key, value == null ? '' : String(value)]),
    );
}
