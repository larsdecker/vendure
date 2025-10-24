import { SimpleGraphQLClient } from '@vendure/testing';

import {
    GET_ELIGIBLE_SHIPPING_METHODS,
    SET_SHIPPING_ADDRESS,
    SET_SHIPPING_METHOD,
    TRANSITION_ORDER_TO_STATE,
} from './graphql/shop-queries';

type ShippingMethod = {
    id: string;
    name: string;
    priceWithTax: number;
};

export async function configureOrderForPayment(shopClient: SimpleGraphQLClient): Promise<void> {
    const addressResult = await shopClient.query(SET_SHIPPING_ADDRESS, {
        input: {
            fullName: 'Test User',
            streetLine1: '123 Test Street',
            city: 'Test City',
            postalCode: '12345',
            countryCode: 'US',
        },
    });
    if (addressResult.setOrderShippingAddress.__typename !== 'Order') {
        throw new Error(addressResult.setOrderShippingAddress.message ?? 'Failed to set shipping address');
    }
    const { eligibleShippingMethods } = await shopClient.query<{ eligibleShippingMethods: ShippingMethod[] }>(
        GET_ELIGIBLE_SHIPPING_METHODS,
    );
    const method = eligibleShippingMethods?.[0];
    if (!method) {
        throw new Error('No eligible shipping method found for the active order.');
    }
    const shippingMethodResult = await shopClient.query(SET_SHIPPING_METHOD, { ids: [method.id] });
    if (shippingMethodResult.setOrderShippingMethod.__typename !== 'Order') {
        throw new Error(shippingMethodResult.setOrderShippingMethod.message ?? 'Failed to set shipping method');
    }
    const transitionResult = await shopClient.query(TRANSITION_ORDER_TO_STATE, { state: 'ArrangingPayment' });
    if (transitionResult.transitionOrderToState.__typename !== 'Order') {
        throw new Error(transitionResult.transitionOrderToState.message ?? 'Failed to transition order state');
    }
}
