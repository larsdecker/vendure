---
title: "PaypalPlugin"
---

The PayPal integration ships with the `@vendure/payments-plugin` package and exposes a configurable
`PaymentMethodHandler` that works with both sandbox and live PayPal environments.

## Requirements

1. Create a PayPal REST application in the [PayPal Developer Dashboard](https://developer.paypal.com/)
   to obtain a client ID and client secret for each environment.
2. Install the Vendure payments plugin package:
   ```bash
   npm install @vendure/payments-plugin
   ```
3. Configure a PaymentMethod in the Admin UI using the **PayPal payments** handler. Supply credentials
   either directly in the Admin UI or via environment variables (`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`).

## Setup

Register the handler and plugin in your `VendureConfig`:

```ts
import { PaypalPlugin, paypalPaymentMethodHandler } from '@vendure/payments-plugin/paypal';

export const config: VendureConfig = {
  // ...
  paymentOptions: {
    paymentMethodHandlers: [paypalPaymentMethodHandler],
  },
  plugins: [PaypalPlugin],
};
```

### Configuration arguments

| Argument        | Description |
|-----------------|-------------|
| `clientId`      | PayPal REST client ID. Falls back to `PAYPAL_CLIENT_ID` when omitted. |
| `clientSecret`  | PayPal REST client secret. Falls back to `PAYPAL_CLIENT_SECRET` when omitted. |
| `mode`          | Either `sandbox` or `live`. Default `sandbox`. |
| `intent`        | Choose `capture` for immediate capture or `authorize` to capture later. Default `capture`. |
| `currency`      | ISO 4217 currency code expected by PayPal. Must match the Vendure channel currency. Default `EUR`. |
| `brandName`     | Optional brand name shown on PayPal's approval pages. |
| `locale`        | Optional locale (e.g. `en-GB`) used for the PayPal approval UI. |

Secrets should not be stored in payment metadata. Prefer environment variables for credentials.

## Checkout flow

1. Call `addPaymentToOrder` with the PayPal payment method.
2. The handler creates a PayPal order and returns payment metadata containing
   `public.approvalUrl`. Redirect the shopper to this URL for approval.
3. After approval, settle the payment. For `capture` intent the order capture happens immediately;
   for `authorize` intent a capture call is performed when the payment is settled.
4. Refunds initiated from the Admin UI call the PayPal Refund API automatically and store the
   resulting refund ID in payment metadata.

Ensure that the currency set on the handler matches the order's currency. The handler validates the
amount and declines the payment if there is a mismatch.

## Webhooks

The plugin registers a webhook controller at `POST /payments/paypal/webhook`. To enable signature
verification:

1. Provide `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, and optionally `PAYPAL_MODE`.
2. Configure the webhook in the PayPal dashboard to send events to your Vendure API host.
3. Make sure your server exposes the raw request body so signature verification can succeed.

Extend the controller if you need to reconcile asynchronous capture or refund events with your
workflow.

## Testing and troubleshooting

- Use PayPal sandbox credentials when testing locally. Sandbox and live credentials are different.
- Unit tests for the handler and service live in `packages/payments-plugin/src/paypal/__tests__` and
  mock network calls with `nock`.
- The handler returns detailed error messages in payment metadata when PayPal responds with an error.
- Vendure stores amounts in **minor units** (e.g. cents). The service converts them to PayPal's major
  units and validates captured amounts.

For more background on how payment integrations work in Vendure, see the
[Payment guide](/guides/core-concepts/payment/).
