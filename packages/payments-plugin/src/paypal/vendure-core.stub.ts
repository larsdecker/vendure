export enum CurrencyCode {
    USD = 'USD',
    JPY = 'JPY',
}

export enum LanguageCode {
    en = 'en',
}

export interface Channel {
    token: string;
}

export interface Order {
    id: number;
    code: string;
    currencyCode: CurrencyCode;
    totalWithTax: number;
}

export interface Payment {
    metadata?: Record<string, unknown> | null;
    transactionId?: string;
}

export interface RequestContext {
    channel: Channel;
    languageCode: LanguageCode;
    apiType?: string;
}

export class UserInputError extends Error {}

export const Logger = {
    error: (..._args: any[]) => undefined,
    warn: (..._args: any[]) => undefined,
    info: (..._args: any[]) => undefined,
    verbose: (..._args: any[]) => undefined,
    debug: (..._args: any[]) => undefined,
};

export class Injector {
    constructor(private moduleRef: any) {}

    get(token: any) {
        return this.moduleRef.get(token, { strict: false });
    }

    resolve(token: any, contextId?: any) {
        return this.moduleRef.resolve(token, contextId, { strict: false });
    }
}

export interface PaymentMethodService {
    getEligiblePaymentMethods(ctx: RequestContext, order: Order): Promise<Array<{ code: string }>>;
    findAll(ctx: RequestContext, options: any): Promise<{ items: any[] }>;
}

export interface CreatePaymentResult {
    amount: number;
    state: 'Settled' | 'Pending' | 'Declined';
    transactionId: string;
    metadata?: Record<string, unknown> | null;
}

export interface SettlePaymentResult {
    success: boolean;
}

export interface CreateRefundResult {
    state: 'Settled' | 'Pending' | 'Failed';
    transactionId?: string;
    metadata?: Record<string, unknown> | null;
}

export class PaymentMethodHandler<T extends { code: string; args?: any }> {
    code: string;
    args: any;
    constructor(public config: T) {
        this.code = config.code;
        this.args = config.args;
        Object.assign(this, config);
    }
}
