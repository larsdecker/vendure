# Vendure PayPal integration

Vendure's PayPal support is provided through the Braintree sub-package that ships with the Payments Plugin.
Braintree allows you to offer both card and PayPal checkout flows via the same drop-in UI. To enable PayPal:

1. Enable PayPal as a payment method inside your Braintree control panel.
2. Install the Payments Plugin alongside the latest `braintree` SDK (version 3.x) in your Vendure server.
3. Configure the [`BraintreePlugin`](../braintree/README.md) in your `vendure-config.ts` and create a payment
   method using the Braintree handler.
4. In your storefront, initialize the Braintree Drop-in with the `paypal` option set so that shoppers can choose
   a PayPal wallet alongside their saved cards.

The plugin automatically stores useful PayPal-specific metadata—such as the authorization ID and payer email—in the
payment record. This information can then be displayed in the Admin UI or exposed in the Shop API if you choose to
surface it to the customer.
