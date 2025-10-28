# PayPal payment handler for Vendure

This package provides a production-ready PayPal integration that plugs into Vendure's payment pipeline via a `PaymentMethodHandler`. It supports both immediate capture and two-step authorize/capture flows, takes care of amount conversion between Vendure (minor units) and PayPal (major units), and exposes optional webhook verification helpers.

## Features

- PayPal REST Orders API (v2) with sandbox and live environments.
- Configurable payment intent (`capture` or `authorize`), brand name, locale, and preferred currency.
- Secure credential handling via configurable operation args or environment variables.
- Robust metadata tracking for PayPal order, authorization, capture, and payer information.
- Optional webhook controller that validates incoming events using the PayPal signature endpoint.
- Unit-tested service and handler with mocked network calls.

## Installing the handler

1. Build the payments plugin package (only needed when working from source):
   ```bash
   npm run build --workspace @vendure/payments-plugin
   ```
2. Import the handler and plugin in your Vendure configuration:
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

## Configuration options

The handler exposes the following configurable arguments in the Admin UI and via the API:

| Argument      | Type     | Description |
|---------------|----------|-------------|
| `clientId`    | string   | PayPal client ID. Marked as a password field in the UI. Optional if `PAYPAL_CLIENT_ID` is set. |
| `clientSecret`| string   | PayPal client secret. Password field. Optional if `PAYPAL_CLIENT_SECRET` is set. |
| `mode`        | select   | `sandbox` (default) or `live`. |
| `intent`      | select   | `capture` (default) to capture immediately, or `authorize` to defer capture until the payment is settled. |
| `currency`    | string   | ISO 4217 currency code PayPal should expect. Must match the channel currency. Default `EUR`. |
| `brandName`   | string   | Optional brand name shown on the PayPal approval page. |
| `locale`      | string   | Optional locale (e.g. `en-GB`) passed to the PayPal application context. |

Secrets should not be stored in metadata. Use environment variables whenever possible.

### Environment variables

| Variable                 | Purpose |
|--------------------------|---------|
| `PAYPAL_CLIENT_ID`       | Default client ID used when the handler arg is omitted. |
| `PAYPAL_CLIENT_SECRET`   | Default client secret. |
| `PAYPAL_MODE`            | Optional override for webhook verification (`sandbox` or `live`). |
| `PAYPAL_WEBHOOK_ID`      | Required to enable webhook signature verification. |

## Typical checkout flow

1. **Create payment** – The storefront calls `addPaymentToOrder` with the PayPal method. The handler creates a PayPal order and returns a payment in the `Authorized` state with `metadata.public.approvalUrl`.
2. **Buyer approval** – Redirect the shopper to `approvalUrl`. After approval PayPal redirects back to your storefront.
3. **Capture** – When the order is completed (e.g. via a custom mutation or webhook), the handler’s `settlePayment` implementation captures the order (or authorization) and transitions the payment to `Settled`.
4. **Refunds** – Refunds created from the Admin UI invoke `createRefund`, which calls PayPal’s capture refund endpoint and records the resulting refund ID in metadata.

For authorize/capture flows the payment remains authorized until `settlePayment` is triggered, either manually from the Admin UI or programmatically (e.g. by a webhook).

## Using the webhook controller

The plugin registers a controller at `POST /payments/paypal/webhook`. To enable signature verification:

1. Set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, and optionally `PAYPAL_MODE` in the environment where Vendure runs.
2. Configure the webhook in the PayPal dashboard to point to `https://<your-api-host>/payments/paypal/webhook`.
3. Ensure your API server preserves the raw request body (the default NestJS JSON parser exposes it on `req.rawBody`).

The controller verifies PayPal’s signature using the REST API and ignores duplicate event IDs. Extend the controller if you need to reconcile asynchronous capture or refund notifications with Vendure’s state machine.

## Known considerations

- Vendure stores amounts in **minor units** (cents). The service converts values to PayPal’s major units and validates the captured amount to avoid mismatches.
- The handler declines payments when the submitted amount or currency does not match the order/channel configuration, preventing accidental over- or under-charging.
- PayPal sandbox and live environments require separate client credentials. Use the handler args or environment variables per channel.
- Do not persist secrets in payment metadata; only store non-sensitive references such as order, capture, or refund identifiers.
- If the handler currency does not match the channel currency, the payment will be declined before hitting the PayPal API.

## Testing

Run the unit tests for the handler and service with Vitest (network calls are mocked with `nock`):

```bash
npx vitest --run packages/payments-plugin/src/paypal/__tests__
```

To perform an end-to-end smoke test against the PayPal sandbox, set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and configure the handler in a development Vendure instance. Create an order, approve the payment via the returned approval URL, and settle or refund the payment from the Admin UI.
