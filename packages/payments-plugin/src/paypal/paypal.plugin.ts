import { PluginCommonModule, VendurePlugin } from '@vendure/core';

import { PaypalService } from './paypal.service';
import { paypalPaymentMethodHandler } from './paypal.handler';
import { PaypalWebhookController } from './paypal.webhook.controller';

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
