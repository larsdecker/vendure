import { Args, Mutation, Resolver } from '@nestjs/graphql';
import {
    ActiveOrderService,
    Allow,
    Ctx,
    PaymentMethodService,
    Permission,
    RequestContext,
    UnauthorizedError,
    UserInputError,
} from '@vendure/core';

import { PaypalService } from '../services/paypal.service';
import { PaypalCreatePaymentIntentInput, PaypalCreatePaymentIntentResult } from '../types/paypal-types';

@Resolver()
export class PaypalResolver {
    constructor(
        private activeOrderService: ActiveOrderService,
        private paymentMethodService: PaymentMethodService,
        private paypalService: PaypalService,
    ) {}

    @Mutation()
    @Allow(Permission.Owner)
    async createPaypalPaymentIntent(
        @Ctx() ctx: RequestContext,
        @Args('input') input: PaypalCreatePaymentIntentInput,
    ): Promise<PaypalCreatePaymentIntentResult> {
        if (!ctx.authorizedAsOwnerOnly) {
            throw new UnauthorizedError();
        }
        const order = await this.activeOrderService.getActiveOrder(ctx, undefined);
        if (!order) {
            throw new UserInputError('No active order found for session');
        }
        const paymentMethod = await this.getPaymentMethod(ctx, input.paymentMethodCode);
        if (!paymentMethod) {
            throw new UserInputError(`PaymentMethod with code ${input.paymentMethodCode} not found`);
        }
        const config = this.paypalService.getHandlerConfigFromArgs(paymentMethod.handler?.args);
        this.paypalService.ensureCredentials(config);
        return this.paypalService.createPaymentIntent(ctx, order, config, input);
    }

    private async getPaymentMethod(ctx: RequestContext, code: string) {
        const { items } = await this.paymentMethodService.findAll(ctx, {
            filter: { code: { eq: code } },
        });
        return items.find(item => item.code === code);
    }
}
