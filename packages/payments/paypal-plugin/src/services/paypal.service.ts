import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Logger, Order, RequestContext } from '@vendure/core';

import {
    PaypalAuthorizationCaptureResponse,
    PaypalAuthorizationDetails,
    PaypalCaptureDetails,
    PaypalCreatePaymentIntentInput,
    PaypalCreatePaymentIntentResult,
    PaypalHandlerConfig,
    PaypalMode,
    PaypalOrderCaptureResponse,
    PaypalOrderResponse,
    PaypalPaymentMetadata,
    PaypalRefundResponse,
} from '../types/paypal-types';

const loggerCtx = 'PaypalPlugin';

interface TokenCacheEntry {
    token: string;
    expiresAt: number;
}

@Injectable()
export class PaypalService {
    private readonly tokenCache = new Map<string, TokenCacheEntry>();

    async createPaymentIntent(
        _ctx: RequestContext,
        order: Order,
        config: PaypalHandlerConfig,
        input: PaypalCreatePaymentIntentInput,
    ): Promise<PaypalCreatePaymentIntentResult> {
        const token = await this.getAccessToken(config);
        const body = {
            intent: config.captureImmediately ? 'CAPTURE' : 'AUTHORIZE',
            purchase_units: [
                {
                    reference_id: order.code,
                    amount: {
                        currency_code: order.currencyCode,
                        value: this.formatAmount(order.totalWithTax, order.currencyCode),
                    },
                },
            ],
            application_context: {
                return_url: input.returnUrl,
                cancel_url: input.cancelUrl,
            },
        };
        const response = await this.fetchFromPaypal<PaypalOrderResponse>(
            config.mode,
            '/v2/checkout/orders',
            token,
            {
                method: 'POST',
                body: JSON.stringify(body),
            },
        );
        const approveUrl = response.links.find(link => link.rel === 'approve')?.href;
        Logger.verbose(
            `Created PayPal order ${response.id} for Vendure order ${order.code}`,
            loggerCtx,
        );
        return {
            id: response.id,
            status: response.status,
            intent: response.intent,
            approveUrl,
        };
    }

    async captureOrder(
        _ctx: RequestContext,
        order: Order,
        config: PaypalHandlerConfig,
        metadata: PaypalPaymentMetadata,
    ): Promise<PaypalCaptureDetails> {
        const token = await this.getAccessToken(config);
        const response = await this.fetchFromPaypal<PaypalOrderCaptureResponse>(
            config.mode,
            `/v2/checkout/orders/${metadata.paypalOrderId}/capture`,
            token,
            {
                method: 'POST',
            },
        );
        const capture = response.purchase_units
            .flatMap(unit => unit.payments.captures ?? [])
            .find(Boolean);
        if (!capture) {
            throw new Error(`No capture details returned for order ${metadata.paypalOrderId}`);
        }
        Logger.verbose(
            `Captured PayPal order ${metadata.paypalOrderId} with capture ${capture.id}`,
            loggerCtx,
        );
        return capture;
    }

    async authorizeOrder(
        _ctx: RequestContext,
        order: Order,
        config: PaypalHandlerConfig,
        metadata: PaypalPaymentMetadata,
    ): Promise<PaypalAuthorizationDetails> {
        const token = await this.getAccessToken(config);
        const response = await this.fetchFromPaypal<PaypalOrderCaptureResponse>(
            config.mode,
            `/v2/checkout/orders/${metadata.paypalOrderId}/authorize`,
            token,
            {
                method: 'POST',
            },
        );
        const authorization = response.purchase_units
            .flatMap(unit => unit.payments.authorizations ?? [])
            .find(Boolean);
        if (!authorization) {
            throw new Error(
                `No authorization details returned for order ${metadata.paypalOrderId}`,
            );
        }
        Logger.verbose(
            `Authorized PayPal order ${metadata.paypalOrderId} with authorization ${authorization.id}`,
            loggerCtx,
        );
        return authorization;
    }

    async captureAuthorization(
        config: PaypalHandlerConfig,
        authorizationId: string,
        currencyCode: CurrencyCode,
    ): Promise<PaypalAuthorizationCaptureResponse> {
        const token = await this.getAccessToken(config);
        const response = await this.fetchFromPaypal<PaypalAuthorizationCaptureResponse>(
            config.mode,
            `/v2/payments/authorizations/${authorizationId}/capture`,
            token,
            {
                method: 'POST',
            },
        );
        Logger.verbose(
            `Captured PayPal authorization ${authorizationId} with capture ${response.id}`,
            loggerCtx,
        );
        if (response.amount.currency_code !== currencyCode) {
            Logger.warn(
                `Currency mismatch while capturing authorization ${authorizationId}: expected ${currencyCode}, received ${response.amount.currency_code}`,
                loggerCtx,
            );
        }
        return response;
    }

    async refundCapture(
        config: PaypalHandlerConfig,
        captureId: string,
        amount: number,
        currencyCode: CurrencyCode,
    ): Promise<PaypalRefundResponse> {
        const token = await this.getAccessToken(config);
        const response = await this.fetchFromPaypal<PaypalRefundResponse>(
            config.mode,
            `/v2/payments/captures/${captureId}/refund`,
            token,
            {
                method: 'POST',
                body: JSON.stringify({
                    amount: {
                        currency_code: currencyCode,
                        value: this.formatAmount(amount, currencyCode),
                    },
                }),
            },
        );
        Logger.verbose(`Refunded PayPal capture ${captureId} with refund ${response.id}`, loggerCtx);
        return response;
    }

    getHandlerConfigFromArgs(args: Array<{ name: string; value: string }> | undefined): PaypalHandlerConfig {
        const getArg = (name: string) => args?.find(arg => arg.name === name)?.value;
        const mode = (getArg('mode') as PaypalMode | undefined) ?? 'sandbox';
        const captureImmediately = getArg('captureImmediately') === 'true';
        const clientId = getArg('clientId');
        const clientSecret = getArg('clientSecret');
        return {
            clientId,
            clientSecret,
            mode,
            captureImmediately,
        };
    }

    ensureCredentials(config: PaypalHandlerConfig): void {
        this.resolveCredentials(config);
    }

    private async getAccessToken(config: PaypalHandlerConfig): Promise<string> {
        const credentials = this.resolveCredentials(config);
        const cacheKey = `${config.mode}:${credentials.clientId}`;
        const now = Date.now();
        const cached = this.tokenCache.get(cacheKey);
        if (cached && cached.expiresAt > now) {
            return cached.token;
        }
        const credentialsEncoded = Buffer.from(
            `${credentials.clientId}:${credentials.clientSecret}`,
        ).toString('base64');
        const response = await fetch(`${this.apiBase(config.mode)}/v1/oauth2/token`, {
            method: 'POST',
            headers: {
                Authorization: `Basic ${credentialsEncoded}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: 'grant_type=client_credentials',
        });
        if (!response.ok) {
            throw new Error(`Failed to retrieve PayPal access token (${response.statusText})`);
        }
        const data: { access_token: string; expires_in: number } = await response.json();
        const expiresAt = now + Math.max(data.expires_in - 60, 0) * 1000;
        this.tokenCache.set(cacheKey, { token: data.access_token, expiresAt });
        return data.access_token;
    }

    private resolveCredentials(config: PaypalHandlerConfig) {
        const clientId = config.clientId ?? process.env.PAYPAL_CLIENT_ID;
        const clientSecret = config.clientSecret ?? process.env.PAYPAL_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
            throw new UnauthorizedException(
                'PayPal credentials are missing. Provide them via handler configuration or PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET environment variables.',
            );
        }
        return { clientId, clientSecret };
    }

    private apiBase(mode: PaypalMode): string {
        return mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
    }

    private async fetchFromPaypal<T>(
        mode: PaypalMode,
        path: string,
        token: string,
        init: { method: string; body?: string; headers?: Record<string, string> },
    ): Promise<T> {
        const response = await fetch(`${this.apiBase(mode)}${path}`, {
            ...init,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
                ...(init.headers ?? {}),
            },
        });
        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`PayPal API error (${response.status}): ${errorBody}`);
        }
        return (await response.json()) as T;
    }

    formatAmount(amount: number, currencyCode: CurrencyCode): string {
        const digits = new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currencyCode,
        }).resolvedOptions().maximumFractionDigits;
        const value = amount / 100;
        return value.toFixed(digits);
    }

    toMinorUnit(amount: string, currencyCode: CurrencyCode): number {
        const numericValue = Number(amount);
        if (Number.isNaN(numericValue)) {
            throw new Error(`Invalid PayPal amount received: ${amount}`);
        }
        const digits = new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currencyCode,
        }).resolvedOptions().maximumFractionDigits;
        // Vendure stores monetary amounts using the default money strategy (precision 2).
        // Normalize to cents to keep the amounts consistent with the rest of the platform.
        if (digits === 0) {
            return Math.round(numericValue) * 100;
        }
        return Math.round(numericValue * 100);
    }
}

export { loggerCtx };
