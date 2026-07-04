import { Kloks } from "./Kloks.js";

const port = process.env.PORT ? parseInt(process.env.PORT) : 10098;
const kloks = new Kloks();

kloks.start(port).then(() => {
    console.log(`[Kloks] successfully started`);
}).catch((err) => {
    console.error(`[Kloks] start failed:`, err);
});
