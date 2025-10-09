import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

export const createHttpClient = (baseURL?: string, timeout = 10000): AxiosInstance => {
  return axios.create({
    baseURL,
    timeout,
    headers: {
      'Content-Type': 'application/json',
    },
  });
};

export const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs = 10000,
  errorMessage = 'Request timeout',
): Promise<T> => {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(errorMessage)), timeoutMs),
  );
  return Promise.race([promise, timeout]);
};

export const normalizePhone = (phone: string): string => {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 10) {
    return `+1${cleaned}`;
  }
  return cleaned.startsWith('1') ? `+${cleaned}` : cleaned;
};

export const normalizeEmail = (email: string): string => {
  return email.toLowerCase().trim();
};