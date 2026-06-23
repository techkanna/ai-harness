export const DEFAULT_LOCAL_LLM_BASE_URL = process.env.MODEL_BASE_URL || 'http://127.0.0.1:1234';
export const DEFAULT_LOCAL_LLM_MAX_TOKENS = Number(process.env.MODEL_MAX_TOKENS || 8192);
export const DEFAULT_LOCAL_LLM_REQUEST_PATH = process.env.MODEL_REQUEST_PATH || '/v1/chat/completions';
export const DEFAULT_LOCAL_LLM_MODEL_NAME = process.env.MODEL_NAME || 'google/gemma-4-e4b';
export const DEFAULT_BROWSER_HOST = process.env.BROWSER_HOST || '127.0.0.1';
export const DEFAULT_BROWSER_PORT = Number(process.env.BROWSER_PORT || 3000);
