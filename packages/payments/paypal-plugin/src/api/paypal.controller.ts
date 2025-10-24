import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Logger } from '@vendure/core';

import { loggerCtx } from '../services/paypal.service';

@Controller('paypal')
export class PaypalController {
    @Post('webhook')
    @HttpCode(200)
    async handleWebhook(@Body() payload: Record<string, unknown>): Promise<{ received: boolean }> {
        Logger.info(`Received PayPal webhook event ${payload?.event_type ?? 'unknown'}`, loggerCtx);
        return { received: true };
    }
}
