/**
 * 页面首次加载收到 401 时，才确认当前会话需要重新认证。
 *
 * 403 表示服务器识别出了用户，但拒绝了本次业务操作（例如点数不足、
 * 项目权限不足），应当把接口错误留在当前页面展示，不能跳转登录页。
 * 长时间生成请求期间的 401 也不立即导航，避免并发刷新造成跳页。
 */
export type AuthResponseContext = 'page-load' | 'mutation'

export function shouldRedirectToLogin(
  status: number,
  context: AuthResponseContext = 'page-load',
): boolean {
  return status === 401 && context === 'page-load'
}
