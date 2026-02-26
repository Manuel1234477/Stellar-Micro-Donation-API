const VALID_STELLAR_NETWORKS = require('../constants').VALID_STELLAR_NETWORKS;
const { securityConfig } = require("./securityConfig");
const log = require("../utils/log");

const getRequiredEnvVars = () => {
  const required = [];

  // API_KEYS are now handled by securityConfig with safe defaults
  // Only require if no safe default available or in production with specific needs

  if (process.env.NODE_ENV === "production") {
    // ENCRYPTION_KEY is handled by securityConfig with generation in dev
    required.push("ENCRYPTION_KEY");
  }

  return required;
};

const isValidBooleanString = (value) => value === "true" || value === "false";

const validateEnvironment = () => {
  if (process.env.NODE_ENV === "test") {
    return;
  }

  const errors = [];
  const requiredEnvVars = getRequiredEnvVars();

  // Validate required environment variables
  for (const variableName of requiredEnvVars) {
    if (!process.env[variableName] || !process.env[variableName].trim()) {
      errors.push(`${variableName} is required but was not set.`);
    }
  }

  // Validate PORT
  if (process.env.PORT) {
    const port = Number(process.env.PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      errors.push(
        `PORT must be an integer between 1 and 65535. Received: "${process.env.PORT}".`,
      );
    }
  }

  // Validate other non-security configs (security configs are handled by securityConfig)
  if (
    process.env.DB_TYPE &&
    !["sqlite", "json"].includes(process.env.DB_TYPE.toLowerCase())
  ) {
    errors.push(
      `DB_TYPE must be 'sqlite' or 'json'. Received: "${process.env.DB_TYPE}"`,
    );
  }

  if (errors.length > 0) {
    const requiredList = getRequiredEnvVars()
      .map((name) => `- ${name}`)
      .join("\n");
    const details = errors.map((error) => `- ${error}`).join("\n");

    log.error("ENV_VALIDATION", "Environment validation failed", {
      errors,
      required: requiredList,
    });

    throw new Error(
      `Environment variable validation failed:\n${details}\n\nRequired variables for this environment:\n${requiredList}`,
    );
  }

  // Log successful validation with security summary
  const securitySummary = require("./securityConfig").getSecuritySummary();
  log.info("ENV_VALIDATION", "Environment validation passed", {
    security: securitySummary,
  });

  /**
   * Self-execution block for CLI/CI usage
   * Task: Fail with clear errors
   */
  if (require.main === module) {
    try {
      console.log("🔍 Validating environment configuration...");
      validateEnvironment();
      console.log("✅ Environment validation passed.");
      console.log("📋 Security Configuration Summary:");
      console.log(JSON.stringify(securitySummary, null, 2));
      process.exit(0);
    } catch (error) {
      console.error("\x1b[31m%s\x1b[0m", "❌ CI/CD Configuration Error:");
      console.error(error.message);
      process.exit(1); // Task: Fail early with non-zero exit code
    }
  }
};;

module.exports = {
  validateEnvironment,
  getRequiredEnvVars,
};
