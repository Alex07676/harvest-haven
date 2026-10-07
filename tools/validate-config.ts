import Ajv from "ajv/dist/2020.js";
import config from "../config/game.config.json" with { type: "json" };
import schema from "../config/game.config.schema.json" with { type: "json" };

const validate = new Ajv({ allErrors: true }).compile(schema);

if (!validate(config)) {
  console.error("Invalid config/game.config.json:");
  for (const error of validate.errors ?? []) {
    console.error(`- ${error.instancePath || "/"} ${error.message ?? "is invalid"}`);
  }
  process.exit(1);
}

console.log(`Config valid: ${config.displayName}`);