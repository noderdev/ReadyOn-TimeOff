"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const crypto_1 = require("crypto");
if (!globalThis.crypto)
    globalThis.crypto = crypto_1.webcrypto;
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const app_module_1 = require("./app.module");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: false,
        transform: true,
    }));
    const configService = app.get(config_1.ConfigService);
    const port = configService.get('PORT', 3000);
    await app.listen(port);
    console.log(`ReadyOn Time-Off Service listening on port ${port}`);
}
bootstrap();
//# sourceMappingURL=main.js.map