# Vendure PayPal Plugin

The PayPal payment plugin provides a native integration with the [PayPal Orders API v2](https://developer.paypal.com/docs/api/orders/v2).
It exposes a `PaymentMethodHandler` that follows the Vendure payment lifecycle while offering a storefront mutation to create PayPal payment intents.

## Installation

```bash
npm install @vendure/paypal-plugin
# or
yarn add @vendure/paypal-plugin
```

## Configuration

Add the plugin to your `VendureConfig` and register a payment method that uses the PayPal handler:

```ts
import { PaypalPlugin, paypalPaymentMethodHandler } from '@vendure/paypal-plugin';

export const config: VendureConfig = {
    plugins: [PaypalPlugin],
    paymentOptions: {
        paymentMethodHandlers: [paypalPaymentMethodHandler],
    },
};
```

### Payment method options

The PayPal handler supports the following options, all of which can be managed through the Admin UI:

| Option              | Description                                                                 |
| ------------------- | --------------------------------------------------------------------------- |
| `clientId`          | The REST API client id. Can be left blank to read from `PAYPAL_CLIENT_ID`.  |
| `clientSecret`      | The REST API client secret. Can be left blank to read from `PAYPAL_CLIENT_SECRET`. |
| `mode`              | Either `sandbox` or `live`.                                                 |
| `captureImmediately`| When disabled the payment is authorized and must be captured later via the Admin UI. |

Secrets are read from environment variables when the handler arguments are not provided, which is recommended for production setups.

### Creating a payment intent from the storefront

The plugin adds the `createPaypalPaymentIntent` mutation to both the Admin and Shop APIs. The typical checkout flow is:

1. Execute the mutation to create a PayPal order and retrieve its approval URL.
2. Redirect the shopper to PayPal (or render the PayPal buttons) so that they approve the transaction.
3. After approval call `addPaymentToOrder` with the PayPal order id as part of the payment metadata:

```ts
await shopClient.query(ADD_PAYMENT, {
    input: {
        method: 'paypal',
        metadata: {
            paypalOrderId: '<PAYPAL_ORDER_ID>',
        },
    },
});
```

If the handler is configured to capture immediately, the payment will be settled automatically. Otherwise it will be created in the `Authorized` state and requires manual capture from the Admin UI.

## Testing

Run the unit tests (which mock the PayPal API by using `nock`):

```bash
npm run test:unit
```

The end-to-end tests rely on the Vendure testing utilities to simulate a checkout flow:

```bash
npm run test:e2e
```

The test suite keeps the coverage above 90% for the plugin package. Coverage thresholds are enforced through Vitest.

## Troubleshooting

- Ensure the correct PayPal environment is selected (`sandbox` versus `live`).
- When running locally set `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` in your environment before starting Vendure.
- Enable verbose logging (`Logger.setLevel('Verbose')`) to receive detailed traces from the PayPal integration during development.

## License

GPL-3.0-or-later
