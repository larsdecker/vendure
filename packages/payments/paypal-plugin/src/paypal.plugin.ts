import { PluginCommonModule, VendurePlugin } from '@vendure/core';
import { gql } from 'graphql-tag';

import { PaypalController } from './api/paypal.controller';
import { PaypalResolver } from './api/paypal.resolver';
import { paypalPaymentMethodHandler } from './paypal-payment.handler';
import { PaypalService } from './services/paypal.service';

const graphqlSchema = gql`
    extend type Mutation {
        createPaypalPaymentIntent(input: PaypalCreatePaymentIntentInput!): PaypalCreatePaymentIntentResult!
    }

    input PaypalCreatePaymentIntentInput {
        paymentMethodCode: String!
        returnUrl: String!
        cancelUrl: String!
    }

    type PaypalCreatePaymentIntentResult {
        id: String!
        status: String!
        intent: String!
        approveUrl: String
    }
`;

@VendurePlugin({
    imports: [PluginCommonModule],
    controllers: [PaypalController],
    providers: [PaypalService],
    configuration: config => {
        config.paymentOptions.paymentMethodHandlers.push(paypalPaymentMethodHandler);
        return config;
    },
    shopApiExtensions: {
        schema: graphqlSchema,
        resolvers: [PaypalResolver],
    },
    adminApiExtensions: {
        schema: graphqlSchema,
        resolvers: [PaypalResolver],
    },
    exports: [PaypalService],
})
export class PaypalPlugin {
    static init(): typeof PaypalPlugin {
        return PaypalPlugin;
    }
}
