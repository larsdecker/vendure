import { CurrencyCode } from '@vendure/common/lib/generated-types';

export type PaypalMode = 'sandbox' | 'live';

export interface PaypalHandlerConfig {
    clientId?: string;
    clientSecret?: string;
    mode: PaypalMode;
    captureImmediately: boolean;
}

export interface PaypalCredentials {
    clientId: string;
    clientSecret: string;
}

export interface PaypalLinkDescription {
    href: string;
    rel: string;
    method: string;
}

export interface PaypalAmount {
    currency_code: CurrencyCode;
    value: string;
}

export interface PaypalOrderResponse {
    id: string;
    status: string;
    intent: 'CAPTURE' | 'AUTHORIZE';
    links: PaypalLinkDescription[];
    purchase_units: Array<{
        reference_id?: string;
        amount: PaypalAmount;
    }>;
}

export interface PaypalCaptureDetails {
    id: string;
    status: string;
    amount: PaypalAmount;
}

export interface PaypalAuthorizationDetails {
    id: string;
    status: string;
    amount: PaypalAmount;
}

export interface PaypalOrderCaptureResponse {
    id: string;
    status: string;
    purchase_units: Array<{
        payments: {
            captures?: PaypalCaptureDetails[];
            authorizations?: PaypalAuthorizationDetails[];
        };
    }>;
}

export interface PaypalAuthorizationCaptureResponse {
    id: string;
    status: string;
    amount: PaypalAmount;
}

export interface PaypalRefundResponse {
    id: string;
    status: string;
    amount: PaypalAmount;
}

export interface PaypalCreatePaymentIntentInput {
    paymentMethodCode: string;
    returnUrl: string;
    cancelUrl: string;
}

export interface PaypalCreatePaymentIntentResult {
    id: string;
    status: string;
    intent: 'CAPTURE' | 'AUTHORIZE';
    approveUrl: string | undefined;
}

export interface PaypalPaymentMetadata {
    paypalOrderId: string;
    captureId?: string;
    authorizationId?: string;
    intent: 'CAPTURE' | 'AUTHORIZE';
}
