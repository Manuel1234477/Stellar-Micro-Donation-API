const VALID_STELLAR_NETWORKS = ['testnet', 'mainnet', 'futurenet'];

const getRequiredEnvVars = () => {
  const required = ['API_KEYS'];

  if (process.env.NODE_ENV === 'production') {
    required.push('ENCRYPTION_KEY');
  }

  return required;
};

const isValidBooleanString = (value) => value === 'true' || value === 'false';

const validateEnvironment = () => {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  const errors = [];
  const requiredEnvVars = getRequiredEnvVars();

  for (const variableName of requiredEnvVars) {
    if (!process.env[variableName] || !process.env[variableName].trim()) {
      errors.push(`${variableName} is required but was not set.`);
    }
  }

  if (process.env.API_KEYS) {
    const keys = process.env.API_KEYS
      .split(',')
      .map((key) => key.trim())
      .filter(Boolean);

    if (keys.length === 0) {
      errors.push('API_KEYS must contain at least one non-empty key.');
    }
  }

  if (process.env.PORT) {
    const port = Number(process.env.PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      errors.push(`PORT must be an integer between 1 and 65535. Received: "${process.env.PORT}".`);
    }
  }

  if (process.env.STELLAR_NETWORK) {
    const network = process.env.STELLAR_NETWORK.toLowerCase();
    if (!VALID_STELLAR_NETWORKS.includes(network)) {
      errors.push(
        `STELLAR_NETWORK must be one of: ${VALID_STELLAR_NETWORKS.join(', ')}. Received: "${process.env.STELLAR_NETWORK}".`
      );
    }
  }

  if (process.env.MOCK_STELLAR && !isValidBooleanString(process.env.MOCK_STELLAR)) {
    errors.push(`MOCK_STELLAR must be either "true" or "false". Received: "${process.env.MOCK_STELLAR}".`);
  }

  if (process.env.HORIZON_URL) {
    try {
      new URL(process.env.HORIZON_URL);
    } catch (error) {
      errors.push(`HORIZON_URL must be a valid URL. Received: "${process.env.HORIZON_URL}".`);
    }
  }

  if (errors.length > 0) {
    const requiredList = getRequiredEnvVars().map((name) => `- ${name}`).join('\n');
    const details = errors.map((error) => `- ${error}`).join('\n');

    throw new Error(
      `Environment variable validation failed:\n${details}\n\nRequired variables for this environment:\n${requiredList}`
    );
  }
};

module.exports = {
  validateEnvironment,
  getRequiredEnvVars,
};
