import DashboardShell from './DashboardShell'

/**
 * Dashboard 布局（同步组件）
 * 所有异步数据获取已移到 DashboardShell 客户端组件中，
 * 避免服务端 layout 异常导致整个路由段白屏。
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardShell>
      {children}
    </DashboardShell>
  )
}
