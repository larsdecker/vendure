/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { mergeConfig } from '@vendure/core';
import {
    CreatePaymentMethodMutation,
    CreatePaymentMethodMutationVariables,
    CurrencyCode,
    GetCustomerListQuery,
    GetCustomerListQueryVariables,
    LanguageCode,
} from '@vendure/core/e2e/graphql/generated-e2e-admin-types';
import {
    AddItemToOrderMutation,
    AddItemToOrderMutationVariables,
    GetActiveOrderQuery,
    TestOrderFragmentFragment,
} from '@vendure/core/e2e/graphql/generated-e2e-shop-types';
import { createTestEnvironment, E2E_DEFAULT_CHANNEL_TOKEN } from '@vendure/testing';
import gql from 'graphql-tag';
import nock from 'nock';
import fetch from 'node-fetch';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { PaypalPlugin } from '../src/paypal';
import { paypalPaymentMethodHandler } from '../src/paypal/paypal.handler';
import { PaypalWebhookEvent } from '../src/paypal/types';

import { CREATE_PAYMENT_METHOD, GET_CUSTOMER_LIST } from './graphql/admin-queries';
import { ADD_ITEM_TO_ORDER, GET_ACTIVE_ORDER } from './graphql/shop-queries';
import { proceedToArrangingPayment, refundOrderLine, setShipping } from './payment-helpers';

type CreatePaypalOrderMutation = {
    createPaypalOrder: {
        id: string;
        status: string;
        approvalUrl: string;
    };
};

type CreatePaypalOrderMutationVariables = Record<string, never>;

const CREATE_PAYPAL_ORDER = gql`
    mutation createPaypalOrder {
        createPaypalOrder {
            id
            status
            approvalUrl
        }
    }
`;

const GET_ORDER_WITH_LINES = gql`
    query GetOrderWithLines($id: ID!) {
        order(id: $id) {
            id
            code
            state
            currencyCode
            lines {
                id
                quantity
            }
            payments {
                id
                transactionId
                amount
                state
                metadata
            }
        }
    }
`;

type GetOrderWithLinesQuery = {
    order: {
        id: string;
        code: string;
        state: string;
        currencyCode: CurrencyCode;
        lines: Array<{ id: string; quantity: number }>;
        payments: Array<{
            id: string;
            transactionId: string;
            amount: number;
            state: string;
            metadata: Record<string, any>;
        }>;
    } | null;
};

describe('PayPal payments', () => {
    const devConfig = mergeConfig(testConfig(), {
        plugins: [PaypalPlugin.init({ environment: 'sandbox' })],
    });
    const { shopClient, adminClient, server } = createTestEnvironment(devConfig);
    let started = false;
    let customers: GetCustomerListQuery['customers']['items'];
    let order: TestOrderFragmentFragment;
    let serverPort: number;
    let lastCustomId: string;

    beforeAll(async () => {
        serverPort = devConfig.apiOptions.port;
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 2,
        });
        started = true;
        await adminClient.asSuperAdmin();
        ({
            customers: { items: customers },
        } = await adminClient.query<GetCustomerListQuery, GetCustomerListQueryVariables>(GET_CUSTOMER_LIST, {
            options: {
                take: 2,
            },
        }));
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('Should start successfully', () => {
        expect(started).toEqual(true);
        expect(customers).toHaveLength(2);
    });

    it('Should prepare an order', async () => {
        await shopClient.asUserWithCredentials(customers[0].emailAddress, 'test');
        const { addItemToOrder } = await shopClient.query<
            AddItemToOrderMutation,
            AddItemToOrderMutationVariables
        >(ADD_ITEM_TO_ORDER, {
            productVariantId: 'T_1',
            quantity: 2,
        });
        order = addItemToOrder as TestOrderFragmentFragment;
        expect(order.code).toBeDefined();
    });

    it('Should add a PayPal paymentMethod', async () => {
        const { createPaymentMethod } = await adminClient.query<
            CreatePaymentMethodMutation,
            CreatePaymentMethodMutationVariables
        >(CREATE_PAYMENT_METHOD, {
            input: {
                code: `paypal-payment-${E2E_DEFAULT_CHANNEL_TOKEN}`,
                translations: [
                    {
                        name: 'PayPal payment test',
                        description: 'This is a PayPal test payment method',
                        languageCode: LanguageCode.en,
                    },
                ],
                enabled: true,
                handler: {
                    code: paypalPaymentMethodHandler.code,
                    arguments: [
                        { name: 'clientId', value: 'test-client-id' },
                        { name: 'clientSecret', value: 'test-client-secret' },
                        { name: 'webhookId', value: 'test-webhook-id' },
                    ],
                },
            },
        });
        expect(createPaymentMethod.code).toBe(`paypal-payment-${E2E_DEFAULT_CHANNEL_TOKEN}`);

        await shopClient.asUserWithCredentials(customers[0].emailAddress, 'test');
        await setShipping(shopClient);
        const { activeOrder } = await shopClient.query<GetActiveOrderQuery>(GET_ACTIVE_ORDER);
        order = activeOrder as TestOrderFragmentFragment;
    });

    it('creates a PayPal order with default metadata', async () => {
        await shopClient.asUserWithCredentials(customers[0].emailAddress, 'test');
        await setShipping(shopClient);
        const { activeOrder } = await shopClient.query<GetActiveOrderQuery>(GET_ACTIVE_ORDER);
        order = activeOrder as TestOrderFragmentFragment;
        let createOrderPayload: any;
        nock('https://api-m.sandbox.paypal.com')
            .post('/v1/oauth2/token', 'grant_type=client_credentials')
            .matchHeader(
                'authorization',
                `Basic ${Buffer.from('test-client-id:test-client-secret').toString('base64')}`,
            )
            .reply(200, { access_token: 'access-token-1' });
        nock('https://api-m.sandbox.paypal.com')
            .post('/v2/checkout/orders', body => {
                createOrderPayload = body;
                return true;
            })
            .matchHeader('authorization', 'Bearer access-token-1')
            .reply(201, {
                id: 'PAYPAL_ORDER_1',
                status: 'CREATED',
                links: [
                    {
                        rel: 'approve',
                        href: 'https://example.test/checkoutnow?token=PAYPAL_ORDER_1',
                        method: 'GET',
                    },
                ],
            });

        const { createPaypalOrder } = await shopClient.query<
            CreatePaypalOrderMutation,
            CreatePaypalOrderMutationVariables
        >(CREATE_PAYPAL_ORDER);

        expect(createPaypalOrder.id).toBe('PAYPAL_ORDER_1');
        expect(createPaypalOrder.approvalUrl).toContain('checkoutnow');
        expect(createOrderPayload.intent).toBe('CAPTURE');
        const purchaseUnit = createOrderPayload.purchase_units[0];
        expect(purchaseUnit.amount.currency_code).toBe(order.currencyCode);
        expect(purchaseUnit.amount.value).toBe((order.totalWithTax / 100).toFixed(2));
        const metadata = JSON.parse(purchaseUnit.custom_id);
        expect(metadata.c).toBe(E2E_DEFAULT_CHANNEL_TOKEN);
        expect(metadata.o).toBe(order.code);
        lastCustomId = purchaseUnit.custom_id;
    });

    it('adds custom metadata when configured', async () => {
        await shopClient.asUserWithCredentials(customers[0].emailAddress, 'test');
        await setShipping(shopClient);
        const { activeOrder } = await shopClient.query<GetActiveOrderQuery>(GET_ACTIVE_ORDER);
        order = activeOrder as TestOrderFragmentFragment;
        PaypalPlugin.options.metadata = async () => ({ foo: 'bar' });
        let createOrderPayload: any;
        nock('https://api-m.sandbox.paypal.com')
            .post('/v1/oauth2/token', 'grant_type=client_credentials')
            .reply(200, { access_token: 'access-token-2' });
        nock('https://api-m.sandbox.paypal.com')
            .post('/v2/checkout/orders', body => {
                createOrderPayload = body;
                return true;
            })
            .matchHeader('authorization', 'Bearer access-token-2')
            .reply(201, {
                id: 'PAYPAL_ORDER_2',
                status: 'CREATED',
                links: [],
            });

        await shopClient.query<CreatePaypalOrderMutation, CreatePaypalOrderMutationVariables>(
            CREATE_PAYPAL_ORDER,
        );
        const metadata = JSON.parse(createOrderPayload.purchase_units[0].custom_id);
        expect(metadata.foo).toBe('bar');
        lastCustomId = createOrderPayload.purchase_units[0].custom_id;
        PaypalPlugin.options.metadata = undefined;
    });

    it('settles the order when the webhook is received', async () => {
        await shopClient.asUserWithCredentials(customers[0].emailAddress, 'test');
        await proceedToArrangingPayment(shopClient);
        const captureAmount = (order.totalWithTax / 100).toFixed(2);

        nock('https://api-m.sandbox.paypal.com')
            .post('/v1/oauth2/token', 'grant_type=client_credentials')
            .reply(200, { access_token: 'access-token-verify' });
        let verifyPayload: any;
        nock('https://api-m.sandbox.paypal.com')
            .post('/v1/notifications/verify-webhook-signature', body => {
                verifyPayload = body;
                return true;
            })
            .matchHeader('authorization', 'Bearer access-token-verify')
            .reply(200, { verification_status: 'SUCCESS' });

        const webhookEvent = {
            id: 'WH-123',
            event_type: 'PAYMENT.CAPTURE.COMPLETED',
            resource: {
                id: 'CAPTURE-123',
                status: 'COMPLETED',
                amount: {
                    value: captureAmount,
                    currency_code: order.currencyCode,
                },
                custom_id: lastCustomId,
                supplementary_data: {
                    related_ids: {
                        order_id: 'PAYPAL_ORDER_2',
                    },
                },
            },
        } satisfies PaypalWebhookEvent;

        const result = await fetch(`http://localhost:${serverPort}/payments/paypal`, {
            method: 'post',
            body: JSON.stringify(webhookEvent),
            headers: {
                'Content-Type': 'application/json',
                'paypal-transmission-id': 'transmission-id',
                'paypal-transmission-time': new Date().toISOString(),
                'paypal-transmission-sig': 'signature',
                'paypal-cert-url': 'https://api-m.sandbox.paypal.com/certs/test',
                'paypal-auth-algo': 'SHA256withRSA',
                'paypal-webhook-id': 'test-webhook-id',
            },
        });

        expect(result.status).toBe(200);
        expect(verifyPayload.webhook_event.id).toBe('WH-123');

        const { order: orderWithPayments } = await adminClient.query<GetOrderWithLinesQuery>(
            GET_ORDER_WITH_LINES,
            {
                id: order.id,
            },
        );
        expect(orderWithPayments?.payments?.[0].transactionId).toBe('CAPTURE-123');
        expect(orderWithPayments?.payments?.[0].state).toBe('Settled');
        expect(orderWithPayments?.payments?.[0].amount).toBe(order.totalWithTax);
    });

    it('creates a refund for a captured payment', async () => {
        const { order: orderWithPayments } = await adminClient.query<GetOrderWithLinesQuery>(
            GET_ORDER_WITH_LINES,
            {
                id: order.id,
            },
        );
        const payment = orderWithPayments?.payments?.[0];
        if (!payment) {
            throw new Error('Expected payment to exist');
        }

        nock('https://api-m.sandbox.paypal.com')
            .post('/v1/oauth2/token', 'grant_type=client_credentials')
            .reply(200, { access_token: 'access-token-refund' });
        let refundPayload: any;
        nock('https://api-m.sandbox.paypal.com')
            .post(`/v2/payments/captures/${payment.transactionId}/refund`, body => {
                refundPayload = body;
                return true;
            })
            .matchHeader('authorization', 'Bearer access-token-refund')
            .reply(200, { status: 'COMPLETED' });

        const refund = await refundOrderLine(
            adminClient,
            orderWithPayments?.lines[0].id ?? '',
            1,
            payment.id,
            0,
        );

        expect(refund.state).toBe('Settled');
        expect(refundPayload.amount.currency_code).toBe(order.currencyCode);
    });
});
