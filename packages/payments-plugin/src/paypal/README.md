# Vendure PayPal integration

This plugin provides a PayPal implementation that mirrors the structure of the Stripe integration. It exposes a `createPaypalOrder` mutation on the shop API and handles webhooks on `/payments/paypal` to settle payments when a capture succeeds.

For setup instructions and storefront usage details, see the [PaypalPlugin documentation](../../../../docs/docs/reference/core-plugins/payments-plugin/paypal-plugin.md).
