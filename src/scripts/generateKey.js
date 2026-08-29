#!/usr/bin/env node
/**
 * generate-key — generate a stable ENCRYPTION_KEY and write it to .env
 *
 * Usage:
 *   npm run generate-key            # writes/updates ENCRYPTION_KEY in .env
 *   npm run generate-key -- --print # only prints the key, does not write
 *   npm run generate-key -- --kms   # wraps a new key with KMS and writes ENCRYPTED_ENCRYPTION_KEY
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '../../.env');
const useKms = process.argv.includes('--kms');
const key = crypto.randomBytes(32).toString('hex');
const printOnly = process.argv.includes('--print');

async function wrapWithKms() {
  const keyId = process.env.KMS_KEY_ID || process.env.AWS_KMS_KEY_ID;
  if (!keyId) {
    throw new Error('KMS_KEY_ID must be set before using --kms');
  }
  try {
    const { KMSClient, EncryptCommand } = require('@aws-sdk/client-kms');
    const client = new KMSClient({ region: process.env.AWS_REGION || 'us-east-1' });
    const result = await client.send(new EncryptCommand({ KeyId: keyId, Plaintext: Buffer.from(key, 'hex') }));
    const wrapped = Buffer.from(result.CiphertextBlob).toString('base64');
    return wrapped;
  } catch (error) {
    throw new Error(`Failed to wrap ENCRYPTION_KEY with KMS: ${error.message}`);
  }
}

(async () => {
  try {
    const wrappedKey = useKms ? await wrapWithKms() : null;

    if (printOnly) {
      console.log(useKms ? wrappedKey : key);
      process.exit(0);
    }

    if (fs.existsSync(ENV_PATH)) {
      let content = fs.readFileSync(ENV_PATH, 'utf8');
      if (useKms) {
        if (/^ENCRYPTED_ENCRYPTION_KEY\s*=/m.test(content)) {
          content = content.replace(/^ENCRYPTED_ENCRYPTION_KEY\s*=.*/m, `ENCRYPTED_ENCRYPTION_KEY=${wrappedKey}`);
          console.log('✔ Updated ENCRYPTED_ENCRYPTION_KEY in .env');
        } else {
          content += `\nENCRYPTED_ENCRYPTION_KEY=${wrappedKey}\n`;
          console.log('✔ Added ENCRYPTED_ENCRYPTION_KEY to .env');
        }
      } else if (/^ENCRYPTION_KEY\s*=/m.test(content)) {
        content = content.replace(/^ENCRYPTION_KEY\s*=.*/m, `ENCRYPTION_KEY=${key}`);
        console.log('✔ Updated ENCRYPTION_KEY in .env');
      } else {
        content += `\nENCRYPTION_KEY=${key}\n`;
        console.log('✔ Added ENCRYPTION_KEY to .env');
      }
      fs.writeFileSync(ENV_PATH, content);
    } else {
      fs.writeFileSync(ENV_PATH, useKms ? `ENCRYPTED_ENCRYPTION_KEY=${wrappedKey}\n` : `ENCRYPTION_KEY=${key}\n`);
      console.log(useKms ? '✔ Created .env with ENCRYPTED_ENCRYPTION_KEY' : '✔ Created .env with ENCRYPTION_KEY');
    }

    console.log('\n⚠️  Keep this key secret and never commit it to version control.');
    console.log('   Changing it will make all previously encrypted data unrecoverable.\n');
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
})();
