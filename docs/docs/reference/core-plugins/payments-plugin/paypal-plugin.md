---
title: "PaypalPlugin"
---

Plugin to enable payments through [PayPal](https://developer.paypal.com/docs/api/overview/) using the Orders v2 API and capture webhooks.

## Requirements

1. Create a REST application in the [PayPal developer dashboard](https://developer.paypal.com/dashboard/) and make a note of the **Client ID** and **Client Secret** for the environment you are targeting (`sandbox` or `live`).
2. Create a webhook for that application which listens to the `PAYMENT.CAPTURE.COMPLETED` event and points to `https://my-server.com/payments/paypal`, where `my-server.com` is the host name of your Vendure server.
3. Add the webhook to your PayPal app and copy the generated webhook ID.
4. Install the Payments plugin (if it is not yet part of your project) with:

    ```shell
    yarn add @vendure/payments-plugin
    # or
    npm install @vendure/payments-plugin
    ```

## Setup

1. Register the plugin in your `VendureConfig`:

    ```ts
    import { PaypalPlugin } from '@vendure/payments-plugin/package/paypal';

    // ...

    plugins: [
      PaypalPlugin.init({
        // Optional: default is 'sandbox'
        environment: 'sandbox',
      }),
    ]
    ```

    The plugin also supports the optional configuration callbacks `metadata`, `purchaseUnit`, and `applicationContext` for advanced integrations.
2. Create a new PaymentMethod in the Admin UI and choose **PayPal payments** as the handler.
3. Enter the Client ID, Client Secret, and Webhook ID that belong to your PayPal application.

## Storefront usage

1. Execute the `createPaypalOrder` mutation from the Shop API for the active order:

    ```graphql
    mutation CreatePaypalOrder {
      createPaypalOrder {
        id
        status
        approvalUrl
      }
    }
    ```

2. Redirect the shopper to the returned `approvalUrl` so they can approve the payment on PayPal.
3. After approval, PayPal will redirect the shopper back to your storefront. You can then complete checkout or wait for the webhook to confirm the capture.

## Webhook handling

PayPal sends a `PAYMENT.CAPTURE.COMPLETED` event to the `/payments/paypal` endpoint when a capture succeeds. The plugin verifies the webhook signature and records the payment automatically. Make sure the raw-body middleware is enabled (it is registered by the plugin) so that signature verification succeeds.

## Refunds

Calling `refundPayment` in the Admin API for a PayPal payment issues a capture refund through the PayPal API. Partial refunds are supported by passing an `amount` in the refund request.

## Plugin options

```ts
interface PaypalPluginOptions {
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
```

All callbacks receive a Vendure `Injector`, the current `RequestContext`, and the active `Order`, enabling you to customize the PayPal order creation request.
