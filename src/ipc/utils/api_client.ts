/**
 * Centralized API client with custom headers for all HTTP requests.
 * Automatically adds Referer and X-Title headers to all requests.
 */

import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';

// Custom headers to be added to all API calls
const CUSTOM_HEADERS = {
  'Referer': 'https://alitech.io',
  'X-Title': 'AliFullStack',
};

/**
 * Enhanced fetch function that automatically adds custom headers
 */
export async function apiFetch(
  url: string | URL | Request,
  options?: RequestInit
): Promise<Response> {
  const headers = new Headers(options?.headers);

  // Add custom headers if they don't already exist
  Object.entries(CUSTOM_HEADERS).forEach(([key, value]) => {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  });

  return fetch(url, {
    ...options,
    headers,
  });
}

/**
 * Enhanced axios function that automatically adds custom headers
 */
export async function apiAxios<T = any>(
  config: AxiosRequestConfig
): Promise<AxiosResponse<T>>;
export async function apiAxios<T = any>(
  url: string,
  config?: AxiosRequestConfig
): Promise<AxiosResponse<T>>;
export async function apiAxios<T = any>(
  urlOrConfig: string | AxiosRequestConfig,
  config?: AxiosRequestConfig
): Promise<AxiosResponse<T>> {
  let finalConfig: AxiosRequestConfig;

  if (typeof urlOrConfig === 'string') {
    finalConfig = { ...config, url: urlOrConfig };
  } else {
    finalConfig = { ...urlOrConfig };
  }

  // Ensure headers object exists
  finalConfig.headers = finalConfig.headers || {};

  // Add custom headers if they don't already exist
  Object.entries(CUSTOM_HEADERS).forEach(([key, value]) => {
    if (!(finalConfig.headers as any)[key]) {
      (finalConfig.headers as any)[key] = value;
    }
  });

  return axios(finalConfig);
}

/**
 * Create an axios instance with custom headers pre-configured
 */
export const createApiAxiosInstance = (config?: AxiosRequestConfig) => {
  const instance = axios.create({
    ...config,
    headers: {
      ...CUSTOM_HEADERS,
      ...config?.headers,
    },
  });

  return instance;
};

/**
 * Get the custom headers object
 */
export const getCustomHeaders = () => ({ ...CUSTOM_HEADERS });