import gql from 'graphql-tag';

export const GET_ACTIVE_ORDER = gql`
    query GetActiveOrder {
        activeOrder {
            id
            code
            state
            totalWithTax
            currencyCode
            lines {
                id
                quantity
                productVariant {
                    id
                }
            }
            payments {
                id
                state
            }
        }
    }
`;

export const ADD_ITEM_TO_ORDER = gql`
    mutation AddItemToOrder($productVariantId: ID!, $quantity: Int!) {
        addItemToOrder(productVariantId: $productVariantId, quantity: $quantity) {
            ... on Order {
                id
                code
                state
                totalWithTax
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

export const SET_SHIPPING_ADDRESS = gql`
    mutation SetOrderShippingAddress($input: CreateAddressInput!) {
        setOrderShippingAddress(input: $input) {
            __typename
            ... on Order {
                id
                code
                state
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

export const GET_ELIGIBLE_SHIPPING_METHODS = gql`
    query GetEligibleShippingMethods {
        eligibleShippingMethods {
            id
            name
            priceWithTax
        }
    }
`;

export const SET_SHIPPING_METHOD = gql`
    mutation SetShippingMethod($ids: [ID!]!) {
        setOrderShippingMethod(shippingMethodId: $ids) {
            __typename
            ... on Order {
                id
                code
                state
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

export const ADD_PAYMENT = gql`
    mutation AddPaymentToOrder($input: PaymentInput!) {
        addPaymentToOrder(input: $input) {
            __typename
            ... on Order {
                id
                state
                payments {
                    id
                    method
                    state
                    transactionId
                    metadata
                }
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

export const TRANSITION_ORDER_TO_STATE = gql`
    mutation TransitionOrderToState($state: String!) {
        transitionOrderToState(state: $state) {
            __typename
            ... on Order {
                id
                state
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;
