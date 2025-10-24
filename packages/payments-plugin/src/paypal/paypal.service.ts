import fetch from 'node-fetch';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Logger, Order, RequestContext } from '@vendure/core';

import {
    PaypalCaptureDetails,
    PaypalCreateOrderInput,
    PaypalCreateOrderResult,
    PaypalHandlerArgs,
    PaypalIntent,
    PaypalMode,
    PaypalOrderDetails,
    PaypalRefundDetails,
    PaypalResolvedConfig,
    PaypalResolvedCredentials,
    PaypalWebhookSignatureInput,
} from './types';

export const loggerCtx = 'PaypalPlugin';

interface TokenCacheEntry {
    token: string;
    expiresAt: number;
}

interface PaypalTokenResponse {
    access_token: string;
    expires_in: number;
    token_type: string;
}

interface PaypalVerifyWebhookResponse {
    verification_status: 'SUCCESS' | 'FAILURE';
}

@Injectable()
export class PaypalService {
    private readonly tokenCache = new Map<string, TokenCacheEntry>();
    private readonly fractionDigitsCache = new Map<string, number>();

    async createOrder(
        ctx: RequestContext,
        order: Order,
        args: PaypalHandlerArgs,
        input: PaypalCreateOrderInput,
    ): Promise<PaypalCreateOrderResult> {
        const config = this.resolveConfig(args);
        this.ensureCurrency(order, config.currencyCode);
        const token = await this.getAccessToken(config);
        const body = {
            intent: input.intent.toUpperCase(),
            purchase_units: [
                {
                    reference_id: input.orderCode,
                    amount: {
                        currency_code: input.currencyCode,
                        value: input.amount,
                    },
                },
            ],
            application_context: {
                return_url: input.returnUrl,
                cancel_url: input.cancelUrl,
                brand_name: input.brandName ?? undefined,
                locale: input.locale ?? undefined,
                user_action: 'PAY_NOW',
            },
        };
        const response = await this.fetchFromPaypal<{
            id: string;
            status: string;
            intent: 'CAPTURE' | 'AUTHORIZE';
            links?: Array<{ rel: string; href: string }>;
        }>(config.mode, '/v2/checkout/orders', token, {
            method: 'POST',
            body: JSON.stringify(body),
        });
        const approvalUrl = response.links?.find(link => link.rel === 'approve')?.href;
        Logger.verbose(`Created PayPal order ${response.id} for ${order.code}`, loggerCtx);
        return {
            id: response.id,
            status: response.status,
            intent: response.intent,
            approvalUrl,
        };
    }

    async captureOrder(configArgs: PaypalHandlerArgs, paypalOrderId: string): Promise<PaypalCaptureDetails> {
        const config = this.resolveConfig(configArgs);
        const token = await this.getAccessToken(config);
        const response = await this.fetchFromPaypal<{
            purchase_units: Array<{ payments: { captures?: PaypalCaptureDetails[] } }>;
        }>(config.mode, `/v2/checkout/orders/${paypalOrderId}/capture`, token, {
            method: 'POST',
        });
        const capture = response.purchase_units
            .flatMap(unit => unit.payments.captures ?? [])
            .find(Boolean);
        if (!capture) {
            throw new Error(`No capture returned for order ${paypalOrderId}`);
        }
        Logger.verbose(`Captured PayPal order ${paypalOrderId} with ${capture.id}`, loggerCtx);
        return capture;
    }

    async getOrder(configArgs: PaypalHandlerArgs, paypalOrderId: string): Promise<PaypalOrderDetails> {
        const config = this.resolveConfig(configArgs);
        const token = await this.getAccessToken(config);
        const response = await this.fetchFromPaypal<PaypalOrderDetails>(
            config.mode,
            `/v2/checkout/orders/${paypalOrderId}`,
            token,
            {
                method: 'GET',
            },
        );
        return response;
    }

    async authorizeOrder(
        configArgs: PaypalHandlerArgs,
        paypalOrderId: string,
    ): Promise<{ id: string; status: string; amount: PaypalCaptureDetails['amount'] }> {
        const config = this.resolveConfig(configArgs);
        const token = await this.getAccessToken(config);
        const response = await this.fetchFromPaypal<{
            purchase_units: Array<{ payments: { authorizations?: Array<{ id: string; status: string; amount: PaypalCaptureDetails['amount'] }> } }>;
        }>(config.mode, `/v2/checkout/orders/${paypalOrderId}/authorize`, token, {
            method: 'POST',
        });
        const authorization = response.purchase_units
            .flatMap(unit => unit.payments.authorizations ?? [])
            .find(Boolean);
        if (!authorization) {
            throw new Error(`No authorization returned for order ${paypalOrderId}`);
        }
        Logger.verbose(`Authorized PayPal order ${paypalOrderId} with ${authorization.id}`, loggerCtx);
        return authorization;
    }

    async captureAuthorization(
        configArgs: PaypalHandlerArgs,
        authorizationId: string,
    ): Promise<PaypalCaptureDetails> {
        const config = this.resolveConfig(configArgs);
        const token = await this.getAccessToken(config);
        const response = await this.fetchFromPaypal<PaypalCaptureDetails>(
            config.mode,
            `/v2/payments/authorizations/${authorizationId}/capture`,
            token,
            {
                method: 'POST',
            },
        );
        Logger.verbose(`Captured PayPal authorization ${authorizationId}`, loggerCtx);
        return response;
    }

    async voidAuthorization(configArgs: PaypalHandlerArgs, authorizationId: string): Promise<void> {
        const config = this.resolveConfig(configArgs);
        const token = await this.getAccessToken(config);
        await this.fetchFromPaypal(config.mode, `/v2/payments/authorizations/${authorizationId}/void`, token, {
            method: 'POST',
        });
        Logger.verbose(`Voided PayPal authorization ${authorizationId}`, loggerCtx);
    }

    async refundCapture(
        configArgs: PaypalHandlerArgs,
        captureId: string,
        amount: string,
        currencyCode: string,
    ): Promise<PaypalRefundDetails> {
        const config = this.resolveConfig(configArgs);
        const token = await this.getAccessToken(config);
        const response = await this.fetchFromPaypal<PaypalRefundDetails>(
            config.mode,
            `/v2/payments/captures/${captureId}/refund`,
            token,
            {
                method: 'POST',
                body: JSON.stringify({
                    amount: {
                        currency_code: currencyCode,
                        value: amount,
                    },
                }),
            },
        );
        Logger.verbose(`Refunded PayPal capture ${captureId} with refund ${response.id}`, loggerCtx);
        return response;
    }

    async verifyWebhookSignature(
        configArgs: PaypalHandlerArgs,
        signature: PaypalWebhookSignatureInput,
    ): Promise<boolean> {
        const webhookId = signature.webhookId;
        if (!webhookId) {
            throw new UnauthorizedException('PayPal webhook ID is required for verification.');
        }
        const config = this.resolveConfig(configArgs);
        const token = await this.getAccessToken(config);
        const response = await this.fetchFromPaypal<PaypalVerifyWebhookResponse>(
            config.mode,
            '/v1/notifications/verify-webhook-signature',
            token,
            {
                method: 'POST',
                body: JSON.stringify({
                    auth_algo: signature.authAlgo,
                    cert_url: signature.certUrl,
                    transmission_id: signature.transmissionId,
                    transmission_sig: signature.transmissionSig,
                    transmission_time: signature.transmissionTime,
                    webhook_id: webhookId,
                    webhook_event: JSON.parse(signature.body),
                }),
            },
        );
        return response.verification_status === 'SUCCESS';
    }

    formatAmount(amountMinor: number, currencyCode: string): string {
        const digits = this.getFractionDigits(currencyCode);
        const factor = Math.pow(10, digits);
        const value = amountMinor / factor;
        return value.toFixed(digits);
    }

    toMinorUnit(amount: string, currencyCode: string): number {
        const numericValue = Number(amount);
        if (Number.isNaN(numericValue)) {
            throw new Error(`Invalid PayPal amount received: ${amount}`);
        }
        const digits = this.getFractionDigits(currencyCode);
        const factor = Math.pow(10, digits);
        return Math.round(numericValue * factor);
    }

    resolveConfig(args: PaypalHandlerArgs): PaypalResolvedConfig {
        const mode = (args.mode ?? 'sandbox') as PaypalMode;
        const intent = (args.intent ?? 'capture') as PaypalIntent;
        const currencyCode = (args.currency ?? 'EUR').toUpperCase() as PaypalResolvedConfig['currencyCode'];
        const credentials = this.resolveCredentials(args, mode);
        return {
            ...credentials,
            mode,
            intent,
            currencyCode,
            brandName: args.brandName ?? undefined,
            locale: args.locale ?? undefined,
        };
    }

    private ensureCurrency(order: Order, currencyCode: string): void {
        if (order.currencyCode !== currencyCode) {
            throw new Error(
                `Currency mismatch: order ${order.code} uses ${order.currencyCode} but PayPal handler is configured for ${currencyCode}.`,
            );
        }
    }

    private async getAccessToken(config: PaypalResolvedConfig): Promise<string> {
        const cacheKey = `${config.clientId}:${config.mode}`;
        const cached = this.tokenCache.get(cacheKey);
        const now = Date.now();
        if (cached && cached.expiresAt > now + 1000) {
            return cached.token;
        }
        const credentials = this.resolveCredentials(config, config.mode);
        const response = await fetch(`${this.apiBase(config.mode)}/v1/oauth2/token`, {
            method: 'POST',
            headers: {
                Authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64')}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: 'grant_type=client_credentials',
        });
        if (!response.ok) {
            const body = await response.text();
            throw new UnauthorizedException(`Failed to authenticate with PayPal: ${response.status} ${body}`);
        }
        const data = (await response.json()) as PaypalTokenResponse;
        const expiresAt = now + data.expires_in * 1000;
        this.tokenCache.set(cacheKey, { token: data.access_token, expiresAt });
        return data.access_token;
    }

    private resolveCredentials(
        args: PaypalHandlerArgs | PaypalResolvedConfig,
        mode: PaypalMode,
    ): PaypalResolvedCredentials {
        const clientId = args.clientId ?? process.env.PAYPAL_CLIENT_ID;
        const clientSecret = args.clientSecret ?? process.env.PAYPAL_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
            throw new UnauthorizedException(
                `Missing PayPal credentials for ${mode} mode. Provide clientId and clientSecret via handler configuration or PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET environment variables.`,
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
        if (response.status === 204) {
            return {} as T;
        }
        return (await response.json()) as T;
    }

    private getFractionDigits(currencyCode: string): number {
        const normalized = currencyCode.toUpperCase();
        if (this.fractionDigitsCache.has(normalized)) {
            return this.fractionDigitsCache.get(normalized)!;
        }
        const digits = new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: normalized,
        }).resolvedOptions().maximumFractionDigits;
        this.fractionDigitsCache.set(normalized, digits);
        return digits;
    }
}
