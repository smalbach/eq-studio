import { createApp } from "./app.ts";
import { readConfig } from "./config.ts";

const config = readConfig();
const app = await createApp(config);
await app.listen(config.port, config.host);
console.log(`Endpoint Quality API (${config.mode}) on http://${config.host}:${config.port} · ${config.database.type === "sqlite" ? config.database.file ?? "in memory" : "postgres"}`);
