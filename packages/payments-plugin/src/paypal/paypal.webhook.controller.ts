import { BadRequestException, Body, Controller, Headers, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { Logger } from '@vendure/core';

import { PaypalService, loggerCtx } from './paypal.service';
import { PaypalHandlerArgs } from './types';

const processedEventIds = new Set<string>();

@Controller('payments/paypal')
export class PaypalWebhookController {
    constructor(private readonly paypalService: PaypalService) {}

    @Post('webhook')
    async handleWebhook(
        @Req() req: Request & { rawBody?: Buffer },
        @Body() body: any,
        @Headers() headers: Record<string, string>,
    ): Promise<{ received: true }> {
        const eventId = typeof body?.id === 'string' ? body.id : undefined;
        if (eventId && processedEventIds.has(eventId)) {
            Logger.debug(`Skipping duplicate PayPal webhook ${eventId}`, loggerCtx);
            return { received: true };
        }
        const webhookId = process.env.PAYPAL_WEBHOOK_ID;
        if (!webhookId) {
            Logger.warn('PAYPAL_WEBHOOK_ID is not set; webhook verification is skipped.', loggerCtx);
            if (eventId) {
                processedEventIds.add(eventId);
            }
            return { received: true };
        }
        const modeEnv = process.env.PAYPAL_MODE === 'live' ? 'live' : 'sandbox';
        const handlerArgs: PaypalHandlerArgs = {
            mode: modeEnv,
        };
        const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(body ?? {});
        const signatureValid = await this.paypalService.verifyWebhookSignature(handlerArgs, {
            webhookId,
            transmissionId: headers['paypal-transmission-id'] ?? headers['PayPal-Transmission-Id'] ?? '',
            transmissionTime: headers['paypal-transmission-time'] ?? headers['PayPal-Transmission-Time'] ?? '',
            transmissionSig: headers['paypal-transmission-sig'] ?? headers['PayPal-Transmission-Sig'] ?? '',
            certUrl: headers['paypal-cert-url'] ?? headers['PayPal-Cert-Url'] ?? '',
            authAlgo: headers['paypal-auth-algo'] ?? headers['PayPal-Auth-Algo'] ?? '',
            body: rawBody,
        });
        if (!signatureValid) {
            throw new BadRequestException('Invalid PayPal webhook signature.');
        }
        if (eventId) {
            processedEventIds.add(eventId);
        }
        Logger.info(`Received PayPal webhook ${body?.event_type ?? 'unknown'}`, loggerCtx);
        return { received: true };
    }
}
