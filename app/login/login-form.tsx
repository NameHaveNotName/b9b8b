'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Film, Eye, EyeOff } from 'lucide-react'

export default function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectUrl = searchParams.get('redirect') || '/dashboard'

  const [isRegister, setIsRegister] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  function validateEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  }

  function validateForm(): string | null {
    if (!email.trim()) return '请输入邮箱'
    if (!validateEmail(email)) return '请输入有效的邮箱地址'
    if (!password) return '请输入密码'
    if (password.length < 6) return '密码长度至少为 6 位'

    if (isRegister) {
      if (password !== confirmPassword) return '两次输入的密码不一致'
    }

    return null
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIsLoading(true)
    setError('')
    setSuccess('')

    const validationError = validateForm()
    if (validationError) {
      setError(validationError)
      setIsLoading(false)
      return
    }

    const supabase = createClient()

    if (isRegister) {
      // 注册流程
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { name: name || email.split('@')[0] },
        },
      })

      if (signUpError) {
        setError(signUpError.message)
        setIsLoading(false)
        return
      }

      if (data.user) {
        // 创建 Prisma User 记录
        try {
          const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: data.user.id,
              email: data.user.email,
              name: name || data.user.email?.split('@')[0] || '',
            }),
          })
          if (!res.ok) {
            console.warn('[Register] Prisma User creation failed:', await res.text())
          }
        } catch (err) {
          console.warn('[Register] Prisma User creation error:', err)
        }

        // 注册成功后自动登录
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        })

        if (signInError) {
          setSuccess('注册成功！请使用新账号登录。')
          setIsRegister(false)
          setIsLoading(false)
          return
        }

        router.push(redirectUrl)
        router.refresh()
      }
    } else {
      // 登录流程
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (signInError) {
        setError(
          signInError.message === 'Invalid login credentials'
            ? '邮箱或密码错误'
            : signInError.message
        )
        setIsLoading(false)
        return
      }

      router.push(redirectUrl)
      router.refresh()
    }

    setIsLoading(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-stone-200 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-stone-900">
            <Film className="h-5 w-5 text-white" />
          </div>
          <h1 className="text-xl font-semibold text-stone-800">
            {isRegister ? '创建账号' : 'AI 影视工作流'}
          </h1>
          <p className="mt-1 text-sm text-stone-500">
            {isRegister ? '注册以开始使用 AI 影视工作流' : '登录以继续管理你的项目'}
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-4 rounded-md bg-green-50 p-3 text-sm text-green-700">
            {success}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {isRegister && (
            <div>
              <label className="mb-1 block text-sm font-medium text-stone-700">
                昵称（可选）
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="你的昵称"
                className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-800 placeholder-stone-400 focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
              />
            </div>
          )}

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

          <div>
            <label className="mb-1 block text-sm font-medium text-stone-700">
              密码
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

          {isRegister && (
            <div>
              <label className="mb-1 block text-sm font-medium text-stone-700">
                确认密码
              </label>
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="再次输入密码"
                required
                className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-800 placeholder-stone-400 focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="flex w-full items-center justify-center rounded-md bg-stone-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-stone-800 disabled:opacity-50"
          >
            {isLoading
              ? isRegister ? '注册中...' : '登录中...'
              : isRegister ? '注册' : '登录'}
          </button>
        </form>

        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-stone-200" />
          <span className="text-xs text-stone-400">或</span>
          <div className="h-px flex-1 bg-stone-200" />
        </div>

        <button
          type="button"
          onClick={() => {
            setIsRegister(!isRegister)
            setError('')
            setSuccess('')
          }}
          className="flex w-full items-center justify-center rounded-md border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
        >
          {isRegister ? '已有账号？直接登录' : '还没有账号？立即注册'}
        </button>

        <p className="mt-4 text-center text-xs text-stone-400">
          更多登录方式即将推出
        </p>
      </div>
    </div>
  )
}
