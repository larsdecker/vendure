import { ensureConfigLoaded, setConfig } from '@vendure/core/dist/config/config-helpers';
import { mergeConfig } from '@vendure/core/dist/config/merge-config';
import gql from 'graphql-tag';
import nock from 'nock';
import path from 'path';
import fs from 'fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
    CREATE_CUSTOMER,
    CREATE_PAYMENT_METHOD,
    CREATE_PRODUCT,
    CREATE_PRODUCT_VARIANTS,
    CREATE_COUNTRY,
    CREATE_ZONE,
    CREATE_SHIPPING_METHOD,
    GET_CUSTOMER_LIST,
    GET_COUNTRY_LIST,
    GET_SHIPPING_METHOD_LIST,
    GET_FIRST_PRODUCT_VARIANT,
    GET_TAX_CATEGORIES,
    GET_ZONES_AND_CHANNELS,
    REFUND_ORDER,
    UPDATE_CHANNEL,
} from './graphql/admin-queries';
import {
    ADD_ITEM_TO_ORDER,
    ADD_PAYMENT,
    GET_ACTIVE_ORDER,
} from './graphql/shop-queries';
import { configureOrderForPayment } from './payment-helpers';

const CREATE_PAYPAL_PAYMENT_INTENT = gql`
    mutation CreatePaypalPaymentIntent($input: PaypalCreatePaymentIntentInput!) {
        createPaypalPaymentIntent(input: $input) {
            id
            status
            intent
            approveUrl
        }
    }
`;

const PAYPAL_BASE = 'https://api-m.sandbox.paypal.com';

await ensureConfigLoaded();
const { default: nodeFetch } = await import('node-fetch');
(globalThis as any).fetch = nodeFetch as any;
if (!process.argv.some(arg => arg.startsWith('--package='))) {
    process.argv.push('--package=payments/paypal-plugin');
}
const { TEST_SETUP_TIMEOUT_MS, testConfig } = await import('../../../e2e-common/test-config');
const { initialData } = await import('../../../e2e-common/e2e-initial-data');
const devConfig = mergeConfig(testConfig(), {
    plugins: [],
});
if (!devConfig.plugins) {
    devConfig.plugins = [];
}
await setConfig(devConfig);
const { createTestEnvironment, E2E_DEFAULT_CHANNEL_TOKEN } = await import('@vendure/testing');
const testEnvironment = createTestEnvironment(devConfig);

describe('PayPal payments', () => {
    const { shopClient, adminClient, server } = testEnvironment;
    let customers: Array<{ emailAddress: string }> = [];
    let manualPaymentMethodCode: string;
    let instantPaymentMethodCode: string;
    let paypalPluginModule: { PaypalPlugin: any } | undefined;
    let paypalPaymentMethodHandler: typeof import('../../src/paypal-payment.handler').paypalPaymentMethodHandler;
    let SETTLE_PAYMENT: typeof import('@vendure/core/e2e/graphql/shared-definitions').SETTLE_PAYMENT;
    let productVariantId: string;

    beforeAll(async () => {
        process.env.PAYPAL_CLIENT_ID = 'test-client-id';
        process.env.PAYPAL_CLIENT_SECRET = 'test-client-secret';
        await ensureConfigLoaded();
        await setConfig(devConfig);
        paypalPluginModule = await import('../../src');
        paypalPaymentMethodHandler = (await import('../../src/paypal-payment.handler')).paypalPaymentMethodHandler;
        ({ SETTLE_PAYMENT } = await import('../../../../core/e2e/graphql/shared-definitions'));
        const productsCsvPath = path.join(__dirname, 'fixtures/e2e-products-minimal.csv');
        if (!fs.existsSync(productsCsvPath)) {
            throw new Error(`Products CSV not found at ${productsCsvPath}`);
        }
        devConfig.plugins.push(paypalPluginModule.PaypalPlugin);
        await setConfig(devConfig);
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 2,
        });
        await adminClient.asSuperAdmin();
        const customerResult = await adminClient.query(GET_CUSTOMER_LIST, {
            options: { take: 2 },
        });
        customers = customerResult.customers.items;
        if (customers.length < 2) {
            const customerInputs = [
                {
                    emailAddress: 'test1@example.com',
                    firstName: 'Test',
                    lastName: 'One',
                },
                {
                    emailAddress: 'test2@example.com',
                    firstName: 'Test',
                    lastName: 'Two',
                },
            ];
            for (const input of customerInputs) {
                const createResult = await adminClient.query(CREATE_CUSTOMER, {
                    input: {
                        ...input,
                        phoneNumber: '1234567890',
                    },
                    password: 'test',
                });
                if (createResult.createCustomer.__typename === 'ErrorResult') {
                    throw new Error(createResult.createCustomer.message);
                }
            }
            const createdCustomers = await adminClient.query(GET_CUSTOMER_LIST, {
                options: { take: 2 },
            });
            customers = createdCustomers.customers.items;
        }
        const variantResult = await adminClient.query(GET_FIRST_PRODUCT_VARIANT, {});
        productVariantId = variantResult.products.items?.[0]?.variants?.[0]?.id ?? '';
        if (!productVariantId) {
            const createProductResult = await adminClient.query(CREATE_PRODUCT, {
                input: {
                    translations: [
                        {
                            languageCode: 'en',
                            name: 'Test Product',
                            slug: 'test-product',
                            description: 'Test product for PayPal e2e',
                        },
                    ],
                },
            });
            const newProductId = createProductResult.createProduct.id;
            const taxCategoriesResult = await adminClient.query(GET_TAX_CATEGORIES, {});
            let zoneAndChannelResult = await adminClient.query(GET_ZONES_AND_CHANNELS, {});
            if (!zoneAndChannelResult.zones.items.length) {
                const countriesResult = await adminClient.query(GET_COUNTRY_LIST, {
                    options: { take: 10 },
                });
                let defaultCountry =
                    countriesResult.countries.items?.find((country: any) => country.code === 'US') ??
                    countriesResult.countries.items?.[0];
                if (!defaultCountry?.id) {
                    const createCountryResult = await adminClient.query(CREATE_COUNTRY, {
                        input: {
                            code: 'US',
                            enabled: true,
                            translations: [{ languageCode: 'en', name: 'United States' }],
                        },
                    });
                    defaultCountry = createCountryResult.createCountry;
                }
                const memberIds = defaultCountry?.id ? [defaultCountry.id] : undefined;
                const createZoneResult = await adminClient.query(CREATE_ZONE, {
                    input: {
                        name: 'PayPal Default Zone',
                        memberIds,
                    },
                });
                if (!createZoneResult.createZone?.id) {
                    throw new Error('Failed to create default tax zone for PayPal e2e tests.');
                }
                zoneAndChannelResult = await adminClient.query(GET_ZONES_AND_CHANNELS, {});
            }
            const defaultChannel = zoneAndChannelResult.channels.items?.find(
                (channel: any) => channel.code === 'default-channel',
            ) ?? zoneAndChannelResult.channels.items?.[0];
            const defaultZone =
                zoneAndChannelResult.zones.items.find((zone: any) => zone.name === 'Europe') ??
                zoneAndChannelResult.zones.items[0];
            if (!defaultChannel?.id) {
                throw new Error('Default channel not found for PayPal e2e tests.');
            }
            if (!defaultZone?.id) {
                throw new Error('Default tax zone not found for PayPal e2e tests.');
            }
            if (!defaultChannel.defaultTaxZone?.id) {
                const updateChannelResult = await adminClient.query(UPDATE_CHANNEL, {
                    input: {
                        id: defaultChannel.id,
                        defaultTaxZoneId: defaultZone.id,
                        defaultShippingZoneId: defaultZone.id,
                    },
                });
                const updateChannelPayload = updateChannelResult.updateChannel;
                if (updateChannelPayload.__typename === 'ErrorResult') {
                    throw new Error(updateChannelPayload.message);
                }
                if (updateChannelPayload.__typename !== 'Channel' || !updateChannelPayload.id) {
                    throw new Error('Failed to update default channel zones for PayPal e2e tests.');
                }
                const channelVerification = await adminClient.query(GET_ZONES_AND_CHANNELS, {});
                const verifiedChannel = channelVerification.channels.items.find((channel: any) => channel.id === defaultChannel.id);
                if (!verifiedChannel?.defaultTaxZone?.id) {
                    throw new Error('Default channel tax zone not set after update.');
                }
            }
            const standardTaxCategoryId =
                taxCategoriesResult.taxCategories.items.find((cat: any) => cat.name === 'Standard Tax')?.id ??
                taxCategoriesResult.taxCategories.items[0]?.id;
            const shippingMethodsResult = await adminClient.query(GET_SHIPPING_METHOD_LIST, {});
            if (!shippingMethodsResult.shippingMethods?.totalItems) {
                const createShippingMethodResult = await adminClient.query(CREATE_SHIPPING_METHOD, {
                    input: {
                        code: 'paypal-standard-shipping',
                        fulfillmentHandler: 'manual-fulfillment',
                        translations: [
                            {
                                languageCode: 'en',
                                name: 'PayPal Standard Shipping',
                                description: 'Flat rate shipping for PayPal e2e tests',
                            },
                        ],
                        checker: {
                            code: 'default-shipping-eligibility-checker',
                            arguments: [{ name: 'orderMinimum', value: '0' }],
                        },
                        calculator: {
                            code: 'default-shipping-calculator',
                            arguments: [
                                { name: 'rate', value: '500' },
                                { name: 'taxRate', value: '0' },
                                { name: 'includesTax', value: 'auto' },
                            ],
                        },
                    },
                });
                if (!createShippingMethodResult.createShippingMethod?.id) {
                    throw new Error('Failed to create shipping method for PayPal e2e tests.');
                }
            }
            const variantInput: any = {
                productId: newProductId,
                sku: 'TEST-1',
                price: 1299,
                stockOnHand: 10,
                translations: [
                    {
                        languageCode: 'en',
                        name: 'Test Variant',
                    },
                ],
            };
            if (standardTaxCategoryId) {
                variantInput.taxCategoryId = standardTaxCategoryId;
            }
            const variantResponse = await adminClient.query(CREATE_PRODUCT_VARIANTS, {
                input: [variantInput],
            });
            const createdVariant = variantResponse.createProductVariants?.[0];
            if (!createdVariant) {
                throw new Error('Failed to create a product variant for PayPal e2e tests.');
            }
            productVariantId = createdVariant.id as string;
        }

        instantPaymentMethodCode = `paypal-immediate-${E2E_DEFAULT_CHANNEL_TOKEN}`;
        manualPaymentMethodCode = `paypal-manual-${E2E_DEFAULT_CHANNEL_TOKEN}`;

        await adminClient.query(CREATE_PAYMENT_METHOD, {
            input: {
                code: instantPaymentMethodCode,
                enabled: true,
                translations: [
                    {
                        languageCode: 'en',
                        name: 'PayPal Immediate',
                        description: 'Immediate capture PayPal method',
                    },
                ],
                handler: {
                    code: paypalPaymentMethodHandler.code,
                    arguments: [
                        { name: 'mode', value: 'sandbox' },
                        { name: 'captureImmediately', value: 'true' },
                    ],
                },
            },
        });

        await adminClient.query(CREATE_PAYMENT_METHOD, {
            input: {
                code: manualPaymentMethodCode,
                enabled: true,
                translations: [
                    {
                        languageCode: 'en',
                        name: 'PayPal Manual',
                        description: 'Manual capture PayPal method',
                    },
                ],
                handler: {
                    code: paypalPaymentMethodHandler.code,
                    arguments: [
                        { name: 'mode', value: 'sandbox' },
                        { name: 'captureImmediately', value: 'false' },
                    ],
                },
            },
        });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    beforeEach(() => {
        nock.cleanAll();
        nock(PAYPAL_BASE)
            .persist()
            .post('/v1/oauth2/token')
            .reply(200, { access_token: 'token', expires_in: 3600 });
    });

    it('creates and settles a PayPal payment with immediate capture', async () => {
        await shopClient.asUserWithCredentials(customers[0].emailAddress, 'test');
        await shopClient.query(ADD_ITEM_TO_ORDER, {
            productVariantId,
            quantity: 1,
        });
        await configureOrderForPayment(shopClient);

        const orderCode = 'PAYPAL_ORDER_CAPTURE';
        nock(PAYPAL_BASE)
            .post('/v2/checkout/orders')
            .reply(201, {
                id: orderCode,
                status: 'CREATED',
                intent: 'CAPTURE',
                links: [{ rel: 'approve', href: 'https://paypal.test/approve', method: 'GET' }],
                purchase_units: [],
            });
        nock(PAYPAL_BASE)
            .post(`/v2/checkout/orders/${orderCode}/capture`)
            .reply(201, {
                id: orderCode,
                status: 'COMPLETED',
                purchase_units: [
                    {
                        payments: {
                            captures: [
                                {
                                    id: 'CAPTURE_1',
                                    status: 'COMPLETED',
                                    amount: { currency_code: 'USD', value: '17.99' },
                                },
                            ],
                        },
                    },
                ],
            });

        const intentResult = await shopClient.query(CREATE_PAYPAL_PAYMENT_INTENT, {
            input: {
                paymentMethodCode: instantPaymentMethodCode,
                returnUrl: 'https://example.com/return',
                cancelUrl: 'https://example.com/cancel',
            },
        });
        expect(intentResult.createPaypalPaymentIntent.id).toBe(orderCode);

        const addPaymentResult = await shopClient.query(ADD_PAYMENT, {
            input: {
                method: instantPaymentMethodCode,
                metadata: {
                    paypalOrderId: orderCode,
                },
            },
        });
        if (addPaymentResult.addPaymentToOrder.__typename !== 'Order') {
            throw new Error(addPaymentResult.addPaymentToOrder.message ?? 'Failed to add PayPal payment');
        }
        expect(addPaymentResult.addPaymentToOrder.payments?.[0]?.state).toBe('Settled');
        expect(addPaymentResult.addPaymentToOrder.payments?.[0]?.transactionId).toBe('CAPTURE_1');
    });

    it('authorizes, settles, and refunds a PayPal payment when captureImmediately is false', async () => {
        await shopClient.asUserWithCredentials(customers[1].emailAddress, 'test');
        await shopClient.query(ADD_ITEM_TO_ORDER, {
            productVariantId,
            quantity: 2,
        });
        await configureOrderForPayment(shopClient);

        const manualOrderId = 'PAYPAL_ORDER_AUTHORIZE';
        const authorizationId = 'AUTH_1';
        const captureId = 'CAPTURE_2';

        nock(PAYPAL_BASE)
            .post('/v2/checkout/orders')
            .reply(201, {
                id: manualOrderId,
                status: 'CREATED',
                intent: 'AUTHORIZE',
                links: [{ rel: 'approve', href: 'https://paypal.test/approve', method: 'GET' }],
                purchase_units: [],
            });
        nock(PAYPAL_BASE)
            .post(`/v2/checkout/orders/${manualOrderId}/authorize`)
            .reply(201, {
                id: manualOrderId,
                status: 'COMPLETED',
                purchase_units: [
                    {
                        payments: {
                            authorizations: [
                                {
                                    id: authorizationId,
                                    status: 'CREATED',
                                    amount: { currency_code: 'USD', value: '30.98' },
                                },
                            ],
                        },
                    },
                ],
            });
        nock(PAYPAL_BASE)
            .post(`/v2/payments/authorizations/${authorizationId}/capture`)
            .reply(201, {
                id: captureId,
                status: 'COMPLETED',
                amount: { currency_code: 'USD', value: '30.98' },
            });
        nock(PAYPAL_BASE)
            .post(`/v2/payments/captures/${captureId}/refund`)
            .reply(201, {
                id: 'REFUND_1',
                status: 'COMPLETED',
                amount: { currency_code: 'USD', value: '12.99' },
            });

        await shopClient.query(CREATE_PAYPAL_PAYMENT_INTENT, {
            input: {
                paymentMethodCode: manualPaymentMethodCode,
                returnUrl: 'https://example.com/return',
                cancelUrl: 'https://example.com/cancel',
            },
        });

        const activeBeforePayment = await shopClient.query(GET_ACTIVE_ORDER);
        const orderLineId = activeBeforePayment.activeOrder?.lines?.[0]?.id;

        const addPaymentResult = await shopClient.query(ADD_PAYMENT, {
            input: {
                method: manualPaymentMethodCode,
                metadata: {
                    paypalOrderId: manualOrderId,
                },
            },
        });
        if (addPaymentResult.addPaymentToOrder.__typename !== 'Order') {
            throw new Error(addPaymentResult.addPaymentToOrder.message ?? 'Failed to add PayPal payment');
        }
        const manualOrder = addPaymentResult.addPaymentToOrder;
        const payment = manualOrder.payments?.[0];
        expect(payment?.state).toBe('Authorized');
        expect(payment?.transactionId).toBe(authorizationId);

        if (!payment?.id) {
            throw new Error('Payment was not created');
        }

        const settleResult = await adminClient.query(SETTLE_PAYMENT, { id: payment.id });
        if (settleResult.settlePayment.__typename === 'ErrorResult') {
            throw new Error(settleResult.settlePayment.message);
        }
        expect(settleResult.settlePayment.transactionId).toBe(captureId);
        expect(settleResult.settlePayment.state).toBe('Settled');

        if (!orderLineId) {
            throw new Error('Order line not found for refund');
        }
        const refundResult = await adminClient.query(REFUND_ORDER, {
            input: {
                lines: [{ orderLineId, quantity: 1 }],
                paymentId: payment.id,
                shipping: 0,
                adjustment: 0,
            },
        });
        if (refundResult.refundOrder.__typename === 'ErrorResult') {
            throw new Error(refundResult.refundOrder.message);
        }
        expect(refundResult.refundOrder.state).toBe('Settled');
    });
});
