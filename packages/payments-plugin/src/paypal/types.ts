import type { Injector, Order, RequestContext } from '@vendure/core';
import type { Request } from 'express';

export interface PaypalPluginOptions {
    environment?: 'sandbox' | 'live';
    intent?: 'CAPTURE' | 'AUTHORIZE';
    metadata?: (
        injector: Injector,
        ctx: RequestContext,
        order: Order,
    ) => Record<string, string> | Promise<Record<string, string>>;
    purchaseUnit?: (
        injector: Injector,
        ctx: RequestContext,
        order: Order,
        defaultPurchaseUnit: PaypalPurchaseUnit,
    ) => PaypalPurchaseUnit | Promise<PaypalPurchaseUnit>;
    applicationContext?: (
        injector: Injector,
        ctx: RequestContext,
        order: Order,
    ) => Record<string, unknown> | Promise<Record<string, unknown>>;
}

export interface PaypalPurchaseUnit {
    amount: {
        currency_code: string;
        value: string;
    };
    custom_id: string;
    reference_id: string;
    description?: string;
    invoice_id?: string;
    [key: string]: unknown;
}

export interface PaypalOrderResponse {
    id: string;
    status: string;
    links?: Array<{
        href: string;
        rel: string;
        method: string;
    }>;
}

export interface PaypalWebhookEvent {
    id: string;
    event_type: string;
    resource: PaypalWebhookResource;
    summary?: string;
    create_time?: string;
    resource_type?: string;
}

export interface PaypalWebhookResource {
    id: string;
    amount?: {
        currency_code: string;
        value: string;
    };
    custom_id?: string;
    status?: string;
    supplementary_data?: {
        related_ids?: {
            order_id?: string;
        };
    };
    [key: string]: unknown;
}

export interface PaypalWebhookHeaders {
    transmissionId: string;
    transmissionTime: string;
    transmissionSig: string;
    certUrl: string;
    authAlgo: string;
    webhookId: string;
}

export interface RequestWithRawBody extends Request {
    rawBody: Buffer;
}

export interface PaypalOrderResult {
    id: string;
    status: string;
    approvalUrl: string;
}
