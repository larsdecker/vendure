import { CurrencyCode } from '@vendure/core';

export type PaypalMode = 'sandbox' | 'live';
export type PaypalIntent = 'capture' | 'authorize';

export interface PaypalHandlerArgs {
    clientId?: string | null;
    clientSecret?: string | null;
    mode?: PaypalMode | null;
    intent?: PaypalIntent | null;
    currency?: CurrencyCode | string | null;
    brandName?: string | null;
    locale?: string | null;
}

export interface PaypalResolvedCredentials {
    clientId: string;
    clientSecret: string;
}

export interface PaypalResolvedConfig extends PaypalResolvedCredentials {
    mode: PaypalMode;
    intent: PaypalIntent;
    currencyCode: CurrencyCode;
    brandName?: string | null;
    locale?: string | null;
}

export interface PaypalPaymentMetadata {
    paypalOrderId: string;
    intent: 'CAPTURE' | 'AUTHORIZE';
    currencyCode: CurrencyCode;
    captureId?: string;
    authorizationId?: string;
    payerEmail?: string;
    public?: {
        approvalUrl?: string;
    };
    error?: string;
}

export interface PaypalCreateOrderInput {
    amount: string;
    currencyCode: CurrencyCode;
    intent: PaypalIntent;
    returnUrl?: string;
    cancelUrl?: string;
    brandName?: string | null;
    locale?: string | null;
    orderCode: string;
}

export interface PaypalCreateOrderResult {
    id: string;
    status: string;
    intent: 'CAPTURE' | 'AUTHORIZE';
    approvalUrl?: string;
}

export interface PaypalCaptureDetails {
    id: string;
    status: string;
    amount: {
        currency_code: CurrencyCode;
        value: string;
    };
    payer?: {
        email_address?: string;
    };
}

export interface PaypalOrderDetails {
    id: string;
    status: string;
    intent: 'CAPTURE' | 'AUTHORIZE';
}

export interface PaypalRefundDetails {
    id: string;
    status: string;
    amount: {
        currency_code: CurrencyCode;
        value: string;
    };
}

export interface PaypalWebhookSignatureInput {
    webhookId: string;
    transmissionId: string;
    transmissionTime: string;
    transmissionSig: string;
    certUrl: string;
    authAlgo: string;
    body: string;
}
