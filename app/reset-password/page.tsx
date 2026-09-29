'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Film, Eye, EyeOff, LoaderCircle } from 'lucide-react'

type RecoveryState = 'checking' | 'ready' | 'invalid'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [recoveryState, setRecoveryState] = useState<RecoveryState>('checking')
  const recoveryCheckStarted = useRef(false)

  useEffect(() => {
    if (recoveryCheckStarted.current) return
    recoveryCheckStarted.current = true
    const supabase = createClient()
    let active = true
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const tokenHash = params.get('token_hash')
    const type = params.get('type')

    const markReadyIfAuthenticated = async (exchangeError?: Error | null) => {
      const { data } = await supabase.auth.getUser()
      if (!active) return
      if (data.user) {
        window.history.replaceState({}, '', '/reset-password')
        setRecoveryState('ready')
      } else {
        setError(exchangeError?.message ? '重置链接无效或已过期，请重新申请。' : '请从密码重置邮件中的链接进入此页面。')
        setRecoveryState('invalid')
      }
    }

    const establishRecoverySession = async () => {
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
        await markReadyIfAuthenticated(exchangeError)
        return
      }
      if (tokenHash && type === 'recovery') {
        const { error: verifyError } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
        await markReadyIfAuthenticated(verifyError)
        return
      }
      await markReadyIfAuthenticated()
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return
      if ((event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session?.user) {
        setRecoveryState('ready')
      }
    })
    void establishRecoverySession()
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (recoveryState !== 'ready') {
      setError('重置链接尚未通过验证，请重新打开邮件中的链接。')
      return
    }
    setIsLoading(true)
    setError('')

    if (password.length < 6) {
      setError('密码长度至少为 6 位')
      setIsLoading(false)
      return
    }

    if (password !== confirmPassword) {
      setError('两次输入的密码不一致')
      setIsLoading(false)
      return
    }

    const supabase = createClient()
    const { error: updateError } = await supabase.auth.updateUser({ password })

    if (updateError) {
      setError(updateError.message)
      setIsLoading(false)
      return
    }

    setSuccess(true)
    setTimeout(() => {
      router.push('/login')
    }, 2000)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-stone-200 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-stone-900">
            <Film className="h-5 w-5 text-white" />
          </div>
          <h1 className="text-xl font-semibold text-stone-800">重置密码</h1>
          <p className="mt-1 text-sm text-stone-500">
            请输入你的新密码
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {recoveryState === 'checking' ? (
          <div className="flex items-center justify-center gap-2 rounded-md bg-stone-50 p-4 text-sm text-stone-600">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            正在验证重置链接…
          </div>
        ) : recoveryState === 'invalid' ? (
          <Link
            href="/forgot-password"
            className="flex w-full items-center justify-center rounded-md bg-stone-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-stone-800"
          >
            重新申请重置邮件
          </Link>
        ) : success ? (
          <div className="space-y-4">
            <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">
              密码重置成功！正在跳转到登录页面...
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-stone-700">
                新密码
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="至少 6 位"
                  required
                  minLength={6}
                  className="w-full rounded-md border border-stone-300 px-3 py-2 pr-10 text-sm text-stone-800 placeholder-stone-400 focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-stone-700">
                确认新密码
              </label>
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="再次输入新密码"
                required
                className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-800 placeholder-stone-400 focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="flex w-full items-center justify-center rounded-md bg-stone-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-stone-800 disabled:opacity-50"
            >
              {isLoading ? '重置中...' : '重置密码'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
