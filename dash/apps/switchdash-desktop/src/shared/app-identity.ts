type ImportMetaWithEnv = ImportMeta & { env?: { DEV?: boolean; VITE_BUILD?: string } };

const env = (import.meta as ImportMetaWithEnv).env;
const isDev = env?.DEV === true;
const isCanary = env?.VITE_BUILD === 'canary';

export const APP_ID = isCanary ? 'com.switchdash.canary' : 'com.switchdash.stable';
export const PRODUCT_NAME = isCanary ? 'Switchdash Canary' : 'Switchdash';
export const APP_NAME_LOWER = isCanary ? 'switchdash-canary' : 'switchdash';
export const USER_DATA_DIR_NAME = isDev
  ? 'switchdash-dev'
  : isCanary
    ? 'switchdash-canary'
    : 'switchdash';
export const UPDATE_CHANNEL = isCanary ? 'v1-canary' : 'v1-stable';
export const ARTIFACT_PREFIX = isCanary ? 'switchdash-canary' : 'switchdash';
export const IS_CANARY = isCanary;

// GitHub repo the desktop app publishes releases to / reads auto-updates from.
// CHOO-1260 config-flip point — see RELEASING.md. Mirrored in
// app-identity.canary.ts (keep in sync).
export const RELEASE_REPO_OWNER = 'sandbox-quantum';
export const RELEASE_REPO_NAME = 'switch';
