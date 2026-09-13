/**
 * 只有 401 表示当前会话需要重新认证。
 *
 * 403 表示服务器识别出了用户，但拒绝了本次业务操作（例如点数不足、
 * 项目权限不足），应当把接口错误留在当前页面展示，不能跳转登录页。
 */
export function shouldRedirectToLogin(status: number): boolean {
  return status === 401
}
