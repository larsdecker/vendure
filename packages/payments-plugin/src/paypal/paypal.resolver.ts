import { Mutation, Resolver } from '@nestjs/graphql';
import {
    ActiveOrderService,
    Allow,
    Ctx,
    Permission,
    RequestContext,
    UnauthorizedError,
    UserInputError,
} from '@vendure/core';

import { PaypalService } from './paypal.service';
import { PaypalOrderResult } from './types';

@Resolver()
export class PaypalResolver {
    constructor(
        private paypalService: PaypalService,
        private activeOrderService: ActiveOrderService,
    ) {}

    @Mutation()
    @Allow(Permission.Owner)
    async createPaypalOrder(@Ctx() ctx: RequestContext): Promise<PaypalOrderResult> {
        if (!ctx.authorizedAsOwnerOnly) {
            throw new UnauthorizedError();
        }
        const order = await this.activeOrderService.getActiveOrder(ctx, undefined);
        if (!order) {
            throw new UserInputError('No active order found for session');
        }
        const paypalOrder = await this.paypalService.createOrder(ctx, order);
        const approvalUrl =
            paypalOrder.links?.find(link => link.rel === 'approve')?.href ??
            paypalOrder.links?.find(link => link.rel === 'payer-action')?.href ??
            '';
        return {
            id: paypalOrder.id,
            status: paypalOrder.status,
            approvalUrl,
        };
    }
}
