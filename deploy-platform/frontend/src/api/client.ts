import axios from 'axios'
import type { AxiosRequestConfig } from 'axios'
import { message } from 'antd'
import { useAuthStore } from '@/stores/auth'
import type { R } from './types'

declare module 'axios' {
  export interface AxiosRequestConfig {
    skipErrorToast?: boolean
  }
}

const client = axios.create({
  baseURL: '/api/v1',
  timeout: 30000,
})

// 请求拦截器：注入 JWT
client.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// 响应拦截器：统一处理错误
client.interceptors.response.use(
  (resp) => {
    const body = resp.data as R
    if (body.code !== 0 && body.code !== undefined) {
      message.error(body.message || '请求失败')
      return Promise.reject(new Error(body.message))
    }
    return resp
  },
  (error) => {
    if (error.response?.status === 401) {
      message.warning('登录已过期，请重新登录')
      useAuthStore.getState().logout()
      window.location.href = '/login'
    } else if (!error.config?.skipErrorToast) {
      const msg = error.response?.data?.message || error.message || '网络错误'
      message.error(msg)
    }
    return Promise.reject(error)
  },
)

// 泛型请求辅助
export async function get<T>(
  url: string,
  params?: Record<string, unknown>,
  config?: AxiosRequestConfig,
): Promise<T> {
  const resp = await client.get<R<T>>(url, { params, ...config })
  return resp.data.data
}

export async function post<T>(url: string, data?: unknown): Promise<T> {
  const resp = await client.post<R<T>>(url, data)
  return resp.data.data
}

/** 连信封一起返回。用于「成功了但有话要说」的接口——message 里带着提示，不能丢。 */
export async function postR<T>(url: string, data?: unknown): Promise<R<T>> {
  const resp = await client.post<R<T>>(url, data)
  return resp.data
}

export async function postLong<T>(url: string, data?: unknown, timeout = 120000): Promise<T> {
  const resp = await client.post<R<T>>(url, data, { timeout })
  return resp.data.data
}

export async function postForm<T>(url: string, form: FormData, timeout = 120000): Promise<T> {
  // 不要手写 multipart Content-Type，否则缺少 boundary，上传会失败
  const resp = await client.post<R<T>>(url, form, { timeout })
  return resp.data.data
}

export async function put<T>(url: string, data?: unknown): Promise<T> {
  const resp = await client.put<R<T>>(url, data)
  return resp.data.data
}

export async function patch<T>(url: string, data?: unknown): Promise<T> {
  const resp = await client.patch<R<T>>(url, data)
  return resp.data.data
}

/** 下载二进制（Agent jar 等）。接口要鉴权，不能用 <a href> 直接跳转。 */
export async function getBlob(url: string, config?: AxiosRequestConfig): Promise<Blob> {
  const resp = await client.get(url, { responseType: 'blob', timeout: 120000, ...config })
  return resp.data as Blob
}

export async function del<T>(url: string): Promise<T> {
  const resp = await client.delete<R<T>>(url)
  return resp.data.data
}

export default client
