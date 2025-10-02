import { PluginCommonModule, Type, VendurePlugin } from '@vendure/core';
import { gql } from 'graphql-tag';

import { PAYPAL_PLUGIN_OPTIONS } from './constants';
import { PaypalController } from './paypal.controller';
import { paypalPaymentMethodHandler } from './paypal.handler';
import { PaypalResolver } from './paypal.resolver';
import { PaypalService } from './paypal.service';
import { rawBodyMiddleware } from './raw-body.middleware';
import { PaypalPluginOptions } from './types';

@VendurePlugin({
    imports: [PluginCommonModule],
    controllers: [PaypalController],
    providers: [
        {
            provide: PAYPAL_PLUGIN_OPTIONS,
            useFactory: (): PaypalPluginOptions => PaypalPlugin.options,
        },
        PaypalService,
    ],
    configuration: config => {
        config.paymentOptions.paymentMethodHandlers.push(paypalPaymentMethodHandler);
        config.apiOptions.middleware.push({
            route: '/payments/paypal',
            handler: rawBodyMiddleware,
            beforeListen: true,
        });
        return config;
    },
    shopApiExtensions: {
        schema: gql`
            type PaypalOrder {
                id: String!
                status: String!
                approvalUrl: String!
            }

            extend type Mutation {
                createPaypalOrder: PaypalOrder!
            }
        `,
        resolvers: [PaypalResolver],
    },
    compatibility: '^3.0.0',
})
export class PaypalPlugin {
    static options: PaypalPluginOptions = {
        environment: 'sandbox',
    };

    static init(options: PaypalPluginOptions): Type<PaypalPlugin> {
        this.options = { environment: 'sandbox', ...options };
        return PaypalPlugin;
    }
}
