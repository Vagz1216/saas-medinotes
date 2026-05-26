import { readFileSync } from 'node:fs';

const envPath = process.argv[2] ?? '.env.local';
const requiredForAzure = [
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_ENDPOINT',
  'AZURE_OPENAI_DEPLOYMENT',
  'AZURE_OPENAI_API_VERSION',
];
const providerEnvKeys = [
  ...requiredForAzure,
  'AZURE_OPENAI_WIRE_API',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'CEREBRAS_API_KEY',
  'GROQ_API_KEY',
];

function parseEnv(path) {
  const values = new Map();
  const contents = readFileSync(path, 'utf8');

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue;
    }

    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    const rawValue = trimmed.slice(index + 1).trim();
    const value = normalizeEnvValue(rawValue);
    values.set(key, { rawValue, value });
  }

  return values;
}

function normalizeEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function hasNonAscii(value) {
  return /[^\x00-\x7F]/.test(value);
}

function report(message) {
  console.error(message);
  failed = true;
}

const values = parseEnv(envPath);
let failed = false;

for (const key of requiredForAzure) {
  if (!values.get(key)?.value) {
    report(`Missing Azure setting: ${key}`);
  }
}

for (const [key, { rawValue, value }] of values.entries()) {
  if (hasNonAscii(key)) {
    report(`Non-ASCII character found in environment key ${key}. Re-type the key name with plain ASCII characters.`);
  }

  if (hasNonAscii(value)) {
    report(`Non-ASCII character found in ${key}. Re-type this value with plain quotes or no quotes.`);
  }

  if (/[“”‘’]/.test(rawValue)) {
    report(`Smart quote found in ${key}. Use straight quotes or no quotes.`);
  }

  if (key.endsWith('KEY') && /\\n/.test(value)) {
    report(`Literal \\n found in ${key}. Remove the copied newline text from the key value.`);
  }
}

const endpoint = values.get('AZURE_OPENAI_ENDPOINT')?.value;
if (endpoint) {
  try {
    const url = new URL(endpoint);
    if (url.pathname !== '/') {
      report('AZURE_OPENAI_ENDPOINT should be the resource origin only, for example https://your-resource.openai.azure.com. Do not include /openai.');
    }
  } catch {
    report('AZURE_OPENAI_ENDPOINT is not a valid URL.');
  }
}

for (const key of providerEnvKeys) {
  const fileValue = values.get(key)?.value;
  const shellValue = process.env[key];

  if (!fileValue || !shellValue) {
    continue;
  }

  if (hasNonAscii(shellValue)) {
    report(`Current shell ${key} contains non-ASCII characters. Re-export it with straight quotes or unset it before starting the app.`);
  }

  if (shellValue !== fileValue) {
    report(`Current shell ${key} differs from ${envPath}. It may override the file value when you run the API. Unset it or make both values match.`);
  }
}

if (failed) {
  process.exit(1);
}

console.log(`Environment check passed for ${envPath}.`);
