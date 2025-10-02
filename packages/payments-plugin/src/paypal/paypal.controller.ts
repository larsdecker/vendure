import { Controller, Headers, HttpStatus, Post, Req, Res } from '@nestjs/common';
import type { PaymentMethod, RequestContext } from '@vendure/core';
import {
    ChannelService,
    InternalServerError,
    LanguageCode,
    Logger,
    Order,
    OrderService,
    PaymentMethodService,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import { OrderStateTransitionError } from '@vendure/core/dist/common/error/generated-graphql-shop-errors';
import type { Response } from 'express';

import { loggerCtx } from './constants';
import { parsePaypalMetadata } from './paypal-utils';
import { paypalPaymentMethodHandler } from './paypal.handler';
import { PaypalService } from './paypal.service';
import { PaypalWebhookEvent, PaypalWebhookHeaders, RequestWithRawBody } from './types';

@Controller('payments')
export class PaypalController {
    constructor(
        private paymentMethodService: PaymentMethodService,
        private orderService: OrderService,
        private paypalService: PaypalService,
        private requestContextService: RequestContextService,
        private connection: TransactionalConnection,
        private channelService: ChannelService,
    ) {}

    @Post('paypal')
    async webhook(
        @Headers('paypal-transmission-id') transmissionId: string | undefined,
        @Headers('paypal-transmission-time') transmissionTime: string | undefined,
        @Headers('paypal-transmission-sig') transmissionSig: string | undefined,
        @Headers('paypal-cert-url') certUrl: string | undefined,
        @Headers('paypal-auth-algo') authAlgo: string | undefined,
        @Headers('paypal-webhook-id') webhookId: string | undefined,
        @Req() request: RequestWithRawBody,
        @Res() response: Response,
    ): Promise<void> {
        if (!request.rawBody) {
            Logger.error('Missing raw request body for PayPal webhook', loggerCtx);
            response.status(HttpStatus.BAD_REQUEST).send('Missing request body');
            return;
        }

        if (!transmissionId || !transmissionTime || !transmissionSig || !certUrl || !authAlgo || !webhookId) {
            Logger.error('Missing PayPal webhook headers', loggerCtx);
            response.status(HttpStatus.BAD_REQUEST).send('Missing webhook headers');
            return;
        }

        let event: PaypalWebhookEvent;
        try {
            event = JSON.parse(request.rawBody.toString('utf8')) as PaypalWebhookEvent;
        } catch (error: any) {
            Logger.error(`Could not parse PayPal webhook payload: ${(error as Error).message}`, loggerCtx);
            response.status(HttpStatus.BAD_REQUEST).send('Invalid payload');
            return;
        }

        const metadata = parsePaypalMetadata(event.resource?.custom_id);
        if (!metadata) {
            Logger.error('PayPal webhook missing expected metadata', loggerCtx);
            response.status(HttpStatus.BAD_REQUEST).send('Missing metadata');
            return;
        }

        const languageCode = metadata.l ?? LanguageCode.en;

        const headers: PaypalWebhookHeaders = {
            transmissionId,
            transmissionTime,
            transmissionSig,
            certUrl,
            authAlgo,
            webhookId,
        };

        const outerCtx = await this.createContext(metadata.c, languageCode, request);

        await this.connection.withTransaction(outerCtx, async (ctx: RequestContext) => {
            const order = await this.orderService.findOneByCode(ctx, metadata.o);

            if (!order) {
                Logger.error(`Unable to find order ${metadata.o} for PayPal webhook`, loggerCtx);
                response.status(HttpStatus.NOT_FOUND).send('Order not found');
                return;
            }

            const isValid = await this.paypalService.verifyWebhookSignature(ctx, headers, event, order);
            if (!isValid) {
                Logger.error('PayPal webhook signature verification failed', loggerCtx);
                response.status(HttpStatus.BAD_REQUEST).send('Invalid signature');
                return;
            }

            if (event.event_type !== 'PAYMENT.CAPTURE.COMPLETED') {
                Logger.info(`Skipping PayPal event ${event.event_type} for order ${order.code}`, loggerCtx);
                response.status(HttpStatus.OK).send('Ignored');
                return;
            }

            if (order.state !== 'ArrangingPayment') {
                let transitionResult = await this.orderService.transitionToState(
                    ctx,
                    order.id,
                    'ArrangingPayment',
                );
                if (transitionResult instanceof OrderStateTransitionError) {
                    const defaultChannel = await this.channelService.getDefaultChannel(ctx);
                    const defaultCtx = await this.createContext(defaultChannel.token, languageCode, request);
                    transitionResult = await this.orderService.transitionToState(
                        defaultCtx,
                        order.id,
                        'ArrangingPayment',
                    );
                }
                if (transitionResult instanceof OrderStateTransitionError) {
                    Logger.error(
                        `Error transitioning order ${order.code} to ArrangingPayment state: ${transitionResult.message}`,
                        loggerCtx,
                    );
                    return;
                }
            }

            const paymentMethod = await this.getPaymentMethod(ctx);
            const amountValue = event.resource.amount?.value;
            if (!amountValue) {
                Logger.error('PayPal webhook missing capture amount', loggerCtx);
                response.status(HttpStatus.BAD_REQUEST).send('Missing capture amount');
                return;
            }

            const addPaymentResult = await this.orderService.addPaymentToOrder(ctx, order.id, {
                method: paymentMethod.code,
                metadata: {
                    paypalOrderId:
                        event.resource.supplementary_data?.related_ids?.order_id ??
                        event.resource.id ??
                        metadata.o,
                    paypalCaptureId: event.resource.id,
                    paypalCaptureAmountValue: amountValue,
                    paypalCaptureCurrencyCode: event.resource.amount?.currency_code,
                    paypalStatus: event.resource.status,
                    paypalCustomId: event.resource.custom_id,
                },
            });

            if (!(addPaymentResult instanceof Order)) {
                Logger.error(
                    `Error adding PayPal payment to order ${order.code}: ${addPaymentResult.message}`,
                    loggerCtx,
                );
                return;
            }

            Logger.info(`PayPal capture ${event.resource.id} added to order ${order.code}`, loggerCtx);
        });

        if (!response.headersSent) {
            response.status(HttpStatus.OK).send('Ok');
        }
    }

    private async createContext(
        channelToken: string,
        languageCode: LanguageCode,
        req: RequestWithRawBody,
    ): Promise<RequestContext> {
        return this.requestContextService.create({
            apiType: 'admin',
            channelOrToken: channelToken,
            req: req as any,
            languageCode,
        });
    }

    private async getPaymentMethod(ctx: RequestContext): Promise<PaymentMethod> {
        const method = (await this.paymentMethodService.findAll(ctx)).items.find(
            m => m.handler.code === paypalPaymentMethodHandler.code,
        );

        if (!method) {
            throw new InternalServerError(`[${loggerCtx}] Could not find PayPal PaymentMethod`);
        }

        return method;
    }
}
