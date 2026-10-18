import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig, } from 'axios';
import { useAuthStore } from '@/store/authStore';
import toast from "react-hot-toast";

if (!process.env.NEXT_PUBLIC_API_URL) {
    throw new Error(
        "NEXT_PUBLIC_API_URL is not configured."
    );
}

const API_BASE_URL =
process.env.NEXT_PUBLIC_API_URL;
const API_ENDPOINTS = {
  LOGIN: "/auth/login",
  REFRESH_TOKEN: "/auth/refresh-token",
};

let isRefreshing = false;
let isLoggingOut = false;

let failedQueue: {
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
}[] = [];

const processQueue = (
  error: unknown,
  token: string | null = null
) => {
  failedQueue.forEach((promise) => {
    if (error) {
      promise.reject(error);
    } else if (token) {
      promise.resolve(token);
    }
  });

  failedQueue = [];
};

let lastToastMessage = "";
let lastToastTime = 0;

const showErrorToast = (message: string) => {
  const now = Date.now();

  if (
    message === lastToastMessage &&
    now - lastToastTime < 2000
  ) {
    return;
  }

  lastToastMessage = message;
  lastToastTime = now;

  toast.error(message);
};

const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: parseInt(process.env.NEXT_PUBLIC_API_TIMEOUT || '30000'),
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use(
  (config) => {
    const { accessToken } = useAuthStore.getState();
    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

interface ApiErrorResponse {
  detail?: string | { msg: string }[];
  message?: string;
  error?: string;
}

const getErrorMessage = (data: ApiErrorResponse | string | null | undefined): string => {
  if (!data) return "Something went wrong.";

  if (typeof data === "string") {
    return data;
  }

  if (data.detail) {
    if (typeof data.detail === "string") {
      return data.detail;
    }

    if (Array.isArray(data.detail)) {
      return data.detail.map((err: { msg: string }) => err.msg).join(", ");
    }
  }

  if (data.message) {
    return data.message;
  }

  if (data.error) {
    return data.error;
  }

  return "Something went wrong.";
};

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig &{_retry?: boolean};
if (error.response?.status === 401 && !originalRequest._retry) {
  if (isRefreshing) {
    return new Promise((resolve, reject) => {
      failedQueue.push({
        resolve: (token: string) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          resolve(api(originalRequest));
        },
        reject,
      });
    });
  }

  originalRequest._retry = true;
  isRefreshing = true;

  const { refreshToken } = useAuthStore.getState();

  if (!refreshToken) {
  
    return Promise.reject(error);
  }

  try {
    const response = await axios.post(
  `${API_BASE_URL}${API_ENDPOINTS.REFRESH_TOKEN}`,
  {
    refresh_token: refreshToken,
  }
);

    const { access_token } = response.data;

    const { setTokens } = useAuthStore.getState();
    setTokens(access_token, refreshToken);

    processQueue(null, access_token);

    if (originalRequest.headers) {
      originalRequest.headers.Authorization = `Bearer ${access_token}`;
    }

    return api(originalRequest);

  } catch (refreshError) {

  processQueue(refreshError, null);

  if (!isLoggingOut) {
    isLoggingOut = true;

    const { logout } = useAuthStore.getState();

    logout();

    showErrorToast("Your session has expired. Please login again.");

    console.error("Refresh token failed:", refreshError);

    window.location.href = "/auth/login";
  }

  return Promise.reject(refreshError);

} finally {
  isRefreshing = false;
}
}
    if (!error.response) {

       console.error("Axios Error:", error);
        console.error("Code:", error.code);
        console.error("URL:", error.config?.url);
        console.error("Response:", error.response);

  // Ignore cancelled requests
  if (axios.isCancel(error) || error.code === "ERR_CANCELED") {
    return Promise.reject(error);
  }

  // Ignore timeout during polling/background refresh
  if (error.code === "ECONNABORTED") {
    console.warn("Request timeout:", error.config?.url);
    return Promise.reject(error);
  }

  console.error("Network Error:", error);

  showErrorToast(
    "Unable to connect to the server. Please check your internet connection."
  );

  return Promise.reject(error);
}
    const status = error.response?.status;
const data = error.response?.data as ApiErrorResponse;

switch (status) {
  case 400:
       showErrorToast(getErrorMessage(data));
    break;

  case 403:
      showErrorToast("You don't have permission to perform this action.");
    break;

  case 404:
      showErrorToast(getErrorMessage(data));
    break;

  case 500:
      showErrorToast("Internal server error. Please try again later.");
    break;
  case 429:
      showErrorToast("Too many requests. Please try again after some time.");
    break;
  default:
      showErrorToast(getErrorMessage(data));
    break;    
}

    return Promise.reject(error);
  }
);

export default api;
