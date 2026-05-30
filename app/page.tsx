import Link from 'next/link'
import { auth } from '@/auth'
import { ArrowRight, Sparkles } from 'lucide-react'

export default async function Home() {
  const session = await auth().catch(() => null)
  const isLoggedIn = !!session?.user

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 md:p-24 bg-gradient-to-b from-stone-50 to-white">
      <div className="max-w-2xl text-center">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-amber-50 px-4 py-1.5 text-sm text-amber-700 border border-amber-200">
          <Sparkles className="h-4 w-4" />
          <span>AI 驱动的影视工业化生产工具</span>
        </div>

        <h1 className="text-4xl md:text-5xl font-bold mb-4 tracking-tight text-stone-900">
          AI 影视全流程工作流系统
        </h1>

        <p className="text-lg text-stone-500 mb-10 leading-relaxed">
          从元构思到成片，AI 辅助影视工业化生产
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          {isLoggedIn ? (
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-stone-800 hover:shadow-lg"
            >
              进入工作台
              <ArrowRight className="h-4 w-4" />
            </Link>
          ) : (
            <>
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-6 py-3 text-sm font-medium text-white transition hover:bg-stone-800 hover:shadow-lg"
              >
                开始使用
                <ArrowRight className="h-4 w-4" />
              </Link>
              <span className="text-sm text-stone-400">或</span>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-6 py-3 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
              >
                登录账号
              </Link>
            </>
          )}
        </div>
      </div>
    </main>
  )
}
