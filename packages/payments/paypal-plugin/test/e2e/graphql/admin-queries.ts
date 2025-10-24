import gql from 'graphql-tag';

export const PAYMENT_METHOD_FRAGMENT = gql`
    fragment PaypalPaymentMethod on PaymentMethod {
        id
        code
        name
        description
        enabled
        handler {
            code
            args {
                name
                value
            }
        }
    }
`;

export const CREATE_PAYMENT_METHOD = gql`
    mutation CreatePaymentMethod($input: CreatePaymentMethodInput!) {
        createPaymentMethod(input: $input) {
            ...PaypalPaymentMethod
        }
    }
    ${PAYMENT_METHOD_FRAGMENT}
`;

export const GET_CUSTOMER_LIST = gql`
    query GetCustomerList($options: CustomerListOptions) {
        customers(options: $options) {
            items {
                id
                firstName
                lastName
                emailAddress
            }
            totalItems
        }
    }
`;

export const GET_ORDER_PAYMENTS = gql`
    query GetOrderPayments($id: ID!) {
        order(id: $id) {
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
    }
`;

export const CREATE_CUSTOMER = gql`
    mutation CreateCustomer($input: CreateCustomerInput!, $password: String) {
        createCustomer(input: $input, password: $password) {
            ... on Customer {
                id
                emailAddress
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

export const GET_FIRST_PRODUCT_VARIANT = gql`
    query GetFirstProductVariant {
        products(options: { take: 1 }) {
            items {
                variants {
                    id
                }
            }
        }
    }
`;

export const CREATE_PRODUCT = gql`
    mutation CreateProduct($input: CreateProductInput!) {
        createProduct(input: $input) {
            id
        }
    }
`;

export const CREATE_PRODUCT_VARIANTS = gql`
    mutation CreateProductVariants($input: [CreateProductVariantInput!]!) {
        createProductVariants(input: $input) {
            id
        }
    }
`;

export const GET_TAX_CATEGORIES = gql`
    query GetTaxCategories {
        taxCategories {
            items {
                id
                name
            }
        }
    }
`;

export const GET_ZONES_AND_CHANNELS = gql`
    query GetZonesAndChannels {
        zones {
            items {
                id
                name
            }
        }
        channels {
            items {
                id
                code
                defaultTaxZone {
                    id
                    name
                }
                defaultShippingZone {
                    id
                    name
                }
            }
        }
    }
`;

export const UPDATE_CHANNEL = gql`
    mutation UpdateChannel($input: UpdateChannelInput!) {
        updateChannel(input: $input) {
            __typename
            ... on Channel {
                id
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

export const GET_COUNTRY_LIST = gql`
    query GetCountryList($options: CountryListOptions) {
        countries(options: $options) {
            items {
                id
                code
                name
            }
        }
    }
`;

export const CREATE_ZONE = gql`
    mutation CreateZone($input: CreateZoneInput!) {
        createZone(input: $input) {
            id
            name
        }
    }
`;

export const CREATE_COUNTRY = gql`
    mutation CreateCountry($input: CreateCountryInput!) {
        createCountry(input: $input) {
            id
            code
            name
        }
    }
`;

export const GET_SHIPPING_METHOD_LIST = gql`
    query GetShippingMethodList {
        shippingMethods(options: { take: 1 }) {
            items {
                id
                code
            }
            totalItems
        }
    }
`;

export const CREATE_SHIPPING_METHOD = gql`
    mutation CreateShippingMethod($input: CreateShippingMethodInput!) {
        createShippingMethod(input: $input) {
            id
            code
        }
    }
`;


export const REFUND_ORDER = gql`
    mutation RefundOrder($input: RefundOrderInput!) {
        refundOrder(input: $input) {
            __typename
            ... on Refund {
                id
                state
                transactionId
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;
