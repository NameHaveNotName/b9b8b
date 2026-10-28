import { redirect } from 'next/navigation'

// 兼容旧书签；登录与注册统一由 /login 页面承载。
export default function RegisterPage() {
  redirect('/login?mode=register')
}
