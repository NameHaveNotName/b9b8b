import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { SessionProvider } from "next-auth/react";
import { auth } from "@/auth";
import { AuthProvider } from "@/lib/auth-context";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AI 影视全流程工作流系统",
  description: "从元构思到成片，AI 辅助影视工业化生产",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // auth() 可能抛出异常（如数据库未连接），用 try-catch 包裹避免布局崩溃
  let session = null
  try {
    session = await auth()
  } catch (e) {
    console.error('[RootLayout] auth() error:', e)
  }

  return (
    <html lang="zh-CN">
      <body className={inter.className}>
        <SessionProvider session={session}>
          <AuthProvider>
            {children}
          </AuthProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
