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
  // 恢复会话是否已被一次真实的恢复流程建立。
  // 必须区分「邮件链接带来的恢复会话」和「用户本来就已登录」——
  // 否则任何已登录用户直接访问 /reset-password 就能改密码。
  const recoverySessionRef = useRef(false)

  useEffect(() => {
    const supabase = createClient()
    let active = true
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const tokenHash = params.get('token_hash')
    const type = params.get('type')

    console.info('[RESET-PASSWORD] 进入页面', {
      hasCode: Boolean(code),
      hasTokenHash: Boolean(tokenHash),
      type: type || null,
      origin: window.location.origin,
    })

    // 只有携带恢复凭据时才算「正在走恢复流程」。
    // 没有凭据的普通访问一律不授予改密能力。
    const hasRecoveryCredential = Boolean(code) || (tokenHash && type === 'recovery')

    const markReady = () => {
      if (!active) return
      recoverySessionRef.current = true
      // 只有确认拿到会话后才清掉 URL 里的凭据，
      // 否则兑换失败时用户会失去重试的机会
      window.history.replaceState({}, '', '/reset-password')
      setRecoveryState('ready')
    }

    const markInvalid = (message?: string) => {
      if (!active) return
      setError(message || (hasRecoveryCredential
        ? '重置链接无效或已过期，请重新申请。'
        : '请从密码重置邮件中的链接进入此页面。'))
      setRecoveryState('invalid')
    }

    const markReadyIfAuthenticated = async (exchangeError?: Error | null) => {
      if (!active) return
      const { data, error: getUserError } = await supabase.auth.getUser()
      if (!active) return
      if (getUserError) {
        console.error('[RESET-PASSWORD] getUser 失败:', getUserError.message)
        markInvalid('验证重置链接时出错，请重新申请或稍后再试。')
        return
      }
      if (!data.user) {
        markInvalid(exchangeError?.message)
        return
      }
      // 无恢复凭据但已有普通登录会话：不能让它变成改密入口
      if (!hasRecoveryCredential && !recoverySessionRef.current) {
        markInvalid('缺少重置凭据，请从密码重置邮件中的链接进入此页面。')
        return
      }
      markReady()
    }

    const establishRecoverySession = async () => {
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
        if (exchangeError) {
          console.error('[RESET-PASSWORD] exchangeCodeForSession 失败:', exchangeError.message)
        }
        await markReadyIfAuthenticated(exchangeError)
        return
      }
      if (tokenHash && type === 'recovery') {
        const { error: verifyError } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
        if (verifyError) {
          console.error('[RESET-PASSWORD] verifyOtp 失败:', verifyError.message)
        }
        await markReadyIfAuthenticated(verifyError)
        return
      }
      // 没有恢复凭据：可能是 SDK 已从 cookie 里建立了恢复会话（INITIAL_SESSION），
      // 交给 onAuthStateChange 的 PASSWORD_RECOVERY 分支处理
      await markReadyIfAuthenticated()
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return
      // 只有 PASSWORD_RECOVERY 才代表「本次访问来自重置邮件」。
      // INITIAL_SESSION / SIGNED_IN 也置位会让已登录用户绕过邮件直接改密码。
      if (event === 'PASSWORD_RECOVERY' && session?.user) {
        console.info('[RESET-PASSWORD] 收到 PASSWORD_RECOVERY 事件')
        markReady()
        return
      }
      if (event === 'SIGNED_IN' && session?.user && hasRecoveryCredential) {
        // 兑换 code 成功后 SDK 会补发一次 SIGNED_IN
        markReady()
      }
    })

    void establishRecoverySession()

    // 注意：这里刻意不使用 "只跑一次" 的 ref 守卫。
    // Next 15 在 dev 下会因 StrictMode 双挂载 effect：
    // 第一次的 cleanup 会把 active 置 false 并退订，第二次若被守卫挡掉
    // 就会永久停在「正在验证重置链接…」。cleanup 负责反注册，
    // 重跑本身是幂等的。
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
      // Supabase 返回的是英文原文，直接透传会让用户看到一串看不懂的英文
      console.error('[RESET-PASSWORD] updateUser 失败:', updateError.message)
      const isExpired = /session|token|expired|auth/i.test(updateError.message)
      setError(
        isExpired
          ? '重置链接已失效，请重新申请一封密码重置邮件。'
          : `密码重置失败：${updateError.message}`
      )
      setIsLoading(false)
      return
    }

    console.info('[RESET-PASSWORD] 密码重置成功')
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
