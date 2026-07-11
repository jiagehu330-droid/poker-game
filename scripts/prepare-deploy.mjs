import { readFile, writeFile } from "node:fs/promises";

const path = "dist/server/wrangler.json";
const config = JSON.parse(await readFile(path, "utf8"));

config.name = "poker-game";
config.topLevelName = "poker-game";
config.d1_databases = [{
  binding: "DB",
  database_name: "poker-game-db",
  database_id: "ec6007db-5f7a-4cf6-867b-f190d05659c2",
}];

await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
console.log("Prepared Cloudflare deployment configuration.");
