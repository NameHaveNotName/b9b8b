'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Film, ArrowLeft } from 'lucide-react'

function resetErrorMessage(error: { message?: string; status?: number }) {
  const message = error.message || ''
  if (error.status === 429 || /rate limit|too many requests/i.test(message)) {
    return '请求过于频繁，请稍后再试。为了保护账号，邮件服务会限制短时间内重复发送。'
  }
  if (/email.*not.*valid|invalid.*email/i.test(message)) return '邮箱格式不正确，请检查后重试。'
  return '暂时无法发送重置邮件，请稍后重试。'
}

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    if (!email.trim()) {
      setError('请输入邮箱')
      setIsLoading(false)
      return
    }

    const supabase = createClient()
    const redirectTo = `${window.location.origin}/reset-password`
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo,
    })

    if (resetError) {
      // 记录实际 origin 与错误，便于定位「生产打不开重置链接」这类问题：
      // 最常见的成因是该 origin 没被加进 Supabase 的 Redirect URLs 白名单，
      // 或部署开了 Vercel Authentication 把 /reset-password?code=… 拦在 edge。
      console.error('[FORGOT-PASSWORD] 发送重置邮件失败', {
        origin: window.location.origin,
        redirectTo,
        message: resetError.message,
      })
      setError(resetErrorMessage(resetError))
      setIsLoading(false)
      return
    }

    console.info('[FORGOT-PASSWORD] 重置邮件已发送', { origin: window.location.origin, redirectTo })
    setSuccess(true)
    setIsLoading(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-stone-200 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-stone-900">
            <Film className="h-5 w-5 text-white" />
          </div>
          <h1 className="text-xl font-semibold text-stone-800">忘记密码</h1>
          <p className="mt-1 text-sm text-stone-500">
            输入你的邮箱，我们将发送密码重置链接
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {success ? (
          <div className="space-y-4">
            <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">
              密码重置邮件已发送，请查收邮件并点击链接重置密码。
            </div>
            <p className="text-xs text-stone-400">
              没有收到邮件？请检查垃圾邮件文件夹，或确认邮箱地址是否正确。
            </p>
            <Link
              href="/login"
              className="flex w-full items-center justify-center rounded-md border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              返回登录
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-stone-700">
                邮箱
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-800 placeholder-stone-400 focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="flex w-full items-center justify-center rounded-md bg-stone-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-stone-800 disabled:opacity-50"
            >
              {isLoading ? '发送中...' : '发送重置链接'}
            </button>

            <Link
              href="/login"
              className="flex w-full items-center justify-center rounded-md border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              返回登录
            </Link>
          </form>
        )}
      </div>
    </div>
  )
}
