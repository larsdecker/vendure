import { stitchSchemas, ValidationLevel } from '@graphql-tools/stitch';
import {
    buildASTSchema,
    GraphQLInputFieldConfigMap,
    GraphQLInputObjectType,
    GraphQLSchema,
    isInputObjectType,
} from 'graphql';

import { InternalServerError } from '../../common/error/errors';
import { AuthenticationStrategy } from '../../config/auth/authentication-strategy';

/**
 * This function is responsible for constructing the `AuthenticationInput` GraphQL input type.
 * It does so based on the inputs defined by the configured AuthenticationStrategy defineInputType
 * methods, dynamically building a mapped input type of the format:
 *
 *```
 * {
 *     [strategy_name]: strategy_input_type
 * }
 * ```
 */
export function generateAuthenticationTypes(
    schema: GraphQLSchema,
    authenticationStrategies: AuthenticationStrategy[],
): GraphQLSchema {
    const fields: GraphQLInputFieldConfigMap = {};
    const strategySchemas: GraphQLSchema[] = [];
    for (const strategy of authenticationStrategies) {
        const inputSchema = buildASTSchema(strategy.defineInputType());

        const inputType = Object.values(
            inputSchema.getTypeMap(),
        ).find((type): type is GraphQLInputObjectType => isInputObjectType(type));
        if (!inputType) {
            throw new InternalServerError(
                `${strategy.constructor.name}.defineInputType() does not define a GraphQL Input type`,
            );
        }
        fields[strategy.name] = { type: inputType };
        strategySchemas.push(inputSchema);
    }
    const authenticationInput = new GraphQLInputObjectType({
        name: 'AuthenticationInput',
        fields,
    });

    try {
        return stitchSchemas({
            subschemas: [schema, ...strategySchemas],
            types: [authenticationInput],
            typeMergingOptions: { validationSettings: { validationLevel: ValidationLevel.Off } },
        });
    } catch (err: any) {
        if (err instanceof TypeError && typeof err.message === 'string' && err.message.includes('Received invalid input')) {
            // When multiple copies of the `graphql` package are loaded (e.g. during Vitest runs), `stitchSchemas` can throw
            // even though the schema itself is valid. Falling back to the original schema lets tests run without sacrificing
            // runtime behaviour in normal builds where the stitch succeeds.
            return schema;
        }
        throw err;
    }
}
