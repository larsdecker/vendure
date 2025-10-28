import { PluginCommonModule, VendurePlugin } from '@vendure/core';

import { PaypalService } from './paypal.service';
import { paypalPaymentMethodHandler } from './paypal.handler';
import { PaypalWebhookController } from './paypal.webhook.controller';

/**
 * @description
 * Plugin to enable payments with [PayPal](https://www.paypal.com/) via the PayPal Orders v2 API.
 *
 * ## Requirements
 *
 * 1. Create a PayPal REST application to obtain a client ID and client secret for the sandbox and live environments.
 * 2. Install the Payments plugin package: `npm install @vendure/payments-plugin`.
 * 3. Configure a PaymentMethod in the Vendure Admin UI and select "PayPal payments" as the handler.
 *
 * ## Setup
 *
 * 1. Register the plugin and handler in your Vendure config:
 *    ```ts
 *    import { PaypalPlugin, paypalPaymentMethodHandler } from '@vendure/payments-plugin/paypal';
 *
 *    export const config: VendureConfig = {
 *      // ...
 *      paymentOptions: {
 *        paymentMethodHandlers: [paypalPaymentMethodHandler],
 *      },
 *      plugins: [PaypalPlugin],
 *    };
 *    ```
 * 2. Provide the PayPal client credentials in the PaymentMethod settings or via the `PAYPAL_CLIENT_ID` and
 *    `PAYPAL_CLIENT_SECRET` environment variables.
 * 3. Choose whether payments should be captured immediately (`capture`) or authorized and captured later (`authorize`).
 *
 * ## Storefront usage
 *
 * The handler exposes the `approvalUrl` in the payment metadata when `createPayment` is called. Redirect the shopper to this
 * PayPal URL for approval. After approval, call `settlePayment` (manually or via a webhook) to capture or settle the payment.
 * Refunds created in the Admin UI invoke the PayPal refund API automatically.
 *
 * ## Webhooks
 *
 * When the optional webhook endpoint (`/payments/paypal/webhook`) is enabled, configure the webhook in the PayPal developer
 * dashboard. The controller validates incoming signatures and can be extended to reconcile asynchronous capture events.
 *
 * @docsCategory core plugins/PaymentsPlugin
 * @docsPage PaypalPlugin
 * @docsWeight 0
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [PaypalService],
    controllers: [PaypalWebhookController],
    configuration: config => {
        config.paymentOptions.paymentMethodHandlers.push(paypalPaymentMethodHandler);
        return config;
    },
})
export class PaypalPlugin {}
