import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Request } from 'express';
import { createRateLimiter } from './security.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

export const PORT = Number(process.env.PORT) || 3000;
export const MODEL_NAME = 'gemini-2.5-flash';
export const ADMIN_EMAILS: string[] = (
  process.env.ADMIN_EMAILS ||
  process.env.ADMIN_EMAIL ||
  ''
)
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
export const MAX_GEMINI_OUTPUT_TOKENS = 1024;
export const PROJECT_ROOT_DIR = ROOT_DIR;

interface FirebaseAppletConfig {
  projectId?: string;
  apiKey?: string;
  firestoreDatabaseId?: string;
}

function loadFirebaseConfig(): FirebaseAppletConfig {
  try {
    const configPath = path.resolve(ROOT_DIR, 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(raw) as FirebaseAppletConfig;
    }
  } catch {
    // Ignore missing config
  }
  return {};
}

const FIREBASE_CONFIG = loadFirebaseConfig();
export const FIREBASE_WEB_API_KEY = FIREBASE_CONFIG.apiKey || '';
export const FIREBASE_PROJECT_ID = FIREBASE_CONFIG.projectId || '';
export const FIRESTORE_DATABASE_ID = FIREBASE_CONFIG.firestoreDatabaseId || '(default)';

export const ALLOWED_WEBHOOK_HOSTS = (process.env.WEBHOOK_ALLOWED_HOSTS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const redisLimiterEnv = {
  redisUrl: process.env.REDIS_URL,
  redisRestUrl: process.env.REDIS_REST_URL,
  redisRestToken: process.env.REDIS_REST_TOKEN,
  failurePolicy: process.env.RATE_LIMIT_FAILURE_POLICY,
  nodeEnv: process.env.NODE_ENV,
};

export const aiUidLimiter = createRateLimiter({
  maxRequests: 15,
  windowMs: FIFTEEN_MIN_MS,
  keyPrefix: 'ithelpdesk:ai:uid:',
  ...redisLimiterEnv,
});

export const aiIpLimiter = createRateLimiter({
  maxRequests: 30,
  windowMs: FIFTEEN_MIN_MS,
  keyPrefix: 'ithelpdesk:ai:ip:',
  ...redisLimiterEnv,
});

export const webhookUidLimiter = createRateLimiter({
  maxRequests: 10,
  windowMs: FIFTEEN_MIN_MS,
  keyPrefix: 'ithelpdesk:webhook:uid:',
  ...redisLimiterEnv,
});

export function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || 'unknown';
}

export function getConfiguredApiKey(): string | null {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key || key === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return key;
}
