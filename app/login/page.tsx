import { Suspense } from 'react'
import LoginForm from './login-form'

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
        <div className="w-full max-w-sm rounded-xl border border-stone-200 bg-white p-8 shadow-sm">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-stone-200 animate-pulse" />
            <div className="mx-auto mb-2 h-6 w-32 rounded bg-stone-200 animate-pulse" />
            <div className="mx-auto h-4 w-48 rounded bg-stone-100 animate-pulse" />
          </div>
          <div className="space-y-4">
            <div className="h-10 rounded bg-stone-100 animate-pulse" />
            <div className="h-10 rounded bg-stone-100 animate-pulse" />
            <div className="h-10 rounded bg-stone-900 animate-pulse" />
          </div>
        </div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  )
}
