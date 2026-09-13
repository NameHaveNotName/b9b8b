"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, BarChart3, Eye, FolderGit2, Users, X, Zap } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Summary = {
  totalOps: number;
  totalUsers: number;
  totalProjects: number;
  totalPointsSpent: number;
};
type Result = {
  id: string;
  kind: string;
  title?: string | null;
  mimeType?: string | null;
  isMock: boolean;
};
type Attempt = {
  id: string;
  provider: string;
  model?: string | null;
  endpoint: string;
  method: string;
  status: string;
  httpStatus?: number | null;
  externalTaskId?: string | null;
  requestId?: string | null;
  durationMs?: number | null;
  errorMessage?: string | null;
  providerCost?: number | null;
  currency?: string | null;
  costSource: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
};
type Operation = {
  id: string;
  actionKey: string;
  category: string;
  status: string;
  type: string;
  pointsCost: number;
  pointsRefunded: number;
  billingSource: string;
  billingGroupId?: string | null;
  providerCost?: number | null;
  currency?: string | null;
  costSource: string;
  projectId?: string | null;
  project?: { title: string } | null;
  workflowStepId?: string | null;
  stepName?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  durationMs?: number | null;
  user: { email: string; name?: string | null };
  providerAttempts: Attempt[];
  results: Result[];
};

const statusLabels: Record<string, string> = {
  SUBMITTED: "已提交",
  RUNNING: "进行中",
  SUCCEEDED: "成功",
  PARTIAL: "部分成功",
  FAILED: "失败",
  CANCELLED: "已取消",
};
const statusClasses: Record<string, string> = {
  SUCCEEDED: "bg-emerald-50 text-emerald-700",
  RUNNING: "bg-blue-50 text-blue-700",
  SUBMITTED: "bg-amber-50 text-amber-700",
  PARTIAL: "bg-orange-50 text-orange-700",
  FAILED: "bg-red-50 text-red-700",
  CANCELLED: "bg-stone-100 text-stone-600",
};

export default function AdminAnalyticsPage() {
  const [days, setDays] = useState(30);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [dailyData, setDailyData] = useState<Array<{ date: string; count: number }>>([]);
  const [typeStats, setTypeStats] = useState<Array<{ type: string; count: number }>>([]);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Operation | null>(null);
  const [preview, setPreview] = useState<{
    url: string;
    mimeType: string;
    title?: string | null;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const query = new URLSearchParams({
      days: String(days),
      page: String(page),
      pageSize: "30",
    });
    if (status) query.set("status", status);
    if (category) query.set("category", category);
    if (provider) query.set("provider", provider);
    if (model.trim()) query.set("model", model.trim());
    if (search.trim()) query.set("search", search.trim());
    try {
      const [analyticsResponse, operationsResponse] = await Promise.all([fetch(`/api/admin/analytics?days=${days}`), fetch(`/api/admin/operations?${query}`)]);
      if (!analyticsResponse.ok || !operationsResponse.ok) throw new Error("LOAD_FAILED");
      const analytics = await analyticsResponse.json();
      const ledger = await operationsResponse.json();
      setSummary(analytics.summary || null);
      setDailyData(analytics.dailyData || []);
      setTypeStats(analytics.typeStats || []);
      setOperations(ledger.operations || []);
      setTotalPages(ledger.pages || 1);
    } finally {
      setLoading(false);
    }
  }, [category, days, model, page, provider, search, status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openPreview(result: Result) {
    setPreviewLoading(true);
    setPreview(null);
    try {
      const response = await fetch(`/api/admin/operation-results/${result.id}/preview`);
      if (!response.ok) throw new Error("该结果没有可预览的持久化文件");
      setPreview(await response.json());
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "预览失败");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function reconcileCost(attempt: Attempt) {
    const raw = window.prompt(`录入 ${attempt.provider} 实际花费（USD）`, attempt.providerCost == null ? "" : String(attempt.providerCost));
    if (raw == null) return;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) return window.alert("请输入不小于 0 的数字");
    const response = await fetch(`/api/admin/provider-attempts/${attempt.id}/cost`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerCost: value, currency: "USD" }),
    });
    if (!response.ok) return window.alert("保存供应商实付失败");
    setSelected(null);
    await load();
  }

  const cards = summary
    ? ([
        ["任务总数", summary.totalOps, Activity],
        ["用户总数", summary.totalUsers, Users],
        ["项目总数", summary.totalProjects, FolderGit2],
        ["消耗点数", summary.totalPointsSpent, Zap],
      ] as const)
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-stone-500">
          <BarChart3 className="mr-1 inline h-4 w-4" />
          供应商任务数据统计
        </p>
        <div className="flex gap-2">
          {[7, 30, 90].map((value) => (
            <button
              key={value}
              onClick={() => {
                setDays(value);
                setPage(1);
              }}
              className={`rounded-lg px-3 py-1.5 text-xs ${days === value ? "bg-stone-800 text-white" : "border bg-white text-stone-600"}`}
            >
              近{value}天
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(([label, value, Icon]) => (
          <div key={label} className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-stone-100 p-2.5">
                <Icon className="h-5 w-5 text-stone-600" />
              </div>
              <div>
                <p className="text-xs text-stone-500">{label}</p>
                <p className="text-xl font-semibold">{value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold">每日任务趋势</h3>
          <div className="h-60">
            <ResponsiveContainer>
              <LineChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Line type="monotone" dataKey="count" stroke="#57534e" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold">操作类型</h3>
          <div className="h-60">
            <ResponsiveContainer>
              <BarChart data={typeStats}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="type" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Bar dataKey="count" fill="#a8a29e" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      <div className="rounded-xl border bg-white shadow-sm">
        <div className="flex flex-wrap gap-2 border-b p-4">
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="用户、项目 ID、任务 ID"
            className="min-w-56 rounded-lg border px-3 py-2 text-sm"
          />
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            <option value="">全部状态</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
              setPage(1);
            }}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            <option value="">全部类别</option>
            {["TEXT", "IMAGE", "VIDEO", "AUDIO", "MUSIC", "OTHER"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <select
            value={provider}
            onChange={(event) => {
              setProvider(event.target.value);
              setPage(1);
            }}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            <option value="">全部供应商</option>
            {["OpenLux", "MiniMax", "DashScope"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <input
            value={model}
            onChange={(event) => {
              setModel(event.target.value);
              setPage(1);
            }}
            placeholder="模型名称"
            className="w-36 rounded-lg border px-3 py-2 text-sm"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] text-left text-sm">
            <thead className="bg-stone-50 text-xs text-stone-500">
              <tr>
                {["时间", "操作人", "项目", "任务性质", "供应商 / 模型", "状态", "点数 / 实付", "耗时", "结果"].map((label) => (
                  <th key={label} className="px-4 py-3 font-medium">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {operations.map((operation) => {
                const first = operation.providerAttempts[0];
                const netPoints = operation.pointsCost - operation.pointsRefunded;
                return (
                  <tr key={operation.id} className="hover:bg-stone-50">
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-stone-500">{new Date(operation.createdAt).toLocaleString("zh-CN")}</td>
                    <td className="px-4 py-3">
                      <div>{operation.user.name || "未命名"}</div>
                      <div className="text-xs text-stone-400">{operation.user.email}</div>
                    </td>
                    <td className="px-4 py-3">{operation.project?.title || operation.projectId?.slice(0, 8) || "—"}</td>
                    <td className="px-4 py-3">
                      <div>{operation.actionKey}</div>
                      <div className="text-xs text-stone-400">{operation.category}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div>{first?.provider || (operation.providerAttempts.length ? "未知供应商" : "无调用明细")}</div>
                      <div className="max-w-44 truncate text-xs text-stone-400">
                        {first?.model || "—"} · {operation.providerAttempts.length} 次调用
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs ${statusClasses[operation.status] || "bg-stone-100"}`}>{statusLabels[operation.status] || operation.status}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        {netPoints} 点 · ¥{(netPoints / 100).toFixed(2)}
                      </div>
                      <div className="text-xs text-stone-400">
                        {operation.pointsRefunded ? `已退 ${operation.pointsRefunded} 点 · ` : ""}
                        {operation.billingSource === "GROUP" ? "小组池" : "个人"}
                      </div>
                      <div className="text-xs text-stone-400">
                        供应商：
                        {operation.providerCost == null ? "待对账" : `${operation.providerCost} ${operation.currency || ""}`}
                      </div>
                    </td>
                    <td className="px-4 py-3">{operation.durationMs == null ? "—" : `${(operation.durationMs / 1000).toFixed(1)}s`}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => {
                          setSelected(operation);
                          setPreview(null);
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs hover:bg-white"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        详情
                        {operation.results.length ? ` / ${operation.results.length}` : ""}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!loading && operations.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-10 text-center text-stone-400">
                    当前筛选范围内没有任务记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
          <span className="text-stone-500">
            第 {page} / {totalPages} 页
          </span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded border px-3 py-1.5 disabled:opacity-40">
              上一页
            </button>
            <button disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)} className="rounded border px-3 py-1.5 disabled:opacity-40">
              下一页
            </button>
          </div>
        </div>
      </div>
      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/35" onClick={() => setSelected(null)}>
          <div className="h-full w-full max-w-2xl overflow-y-auto bg-white p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold">任务详情</h2>
                <p className="font-mono text-xs text-stone-400">{selected.id}</p>
              </div>
              <button onClick={() => setSelected(null)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-3 rounded-lg bg-stone-50 p-4 text-sm">
              <div>
                <dt className="text-xs text-stone-400">项目</dt>
                <dd>{selected.project?.title || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-stone-400">操作人</dt>
                <dd>{selected.user.email}</dd>
              </div>
              <div>
                <dt className="text-xs text-stone-400">状态</dt>
                <dd>{statusLabels[selected.status] || selected.status}</dd>
              </div>
              <div>
                <dt className="text-xs text-stone-400">点数收入</dt>
                <dd>
                  {selected.pointsCost - selected.pointsRefunded} 点 · ¥{((selected.pointsCost - selected.pointsRefunded) / 100).toFixed(2)}
                </dd>
                <dd className="text-xs text-stone-400">
                  原扣 {selected.pointsCost} 点{selected.pointsRefunded ? `，已退 ${selected.pointsRefunded} 点` : ""}
                </dd>
                <dd className="text-xs text-stone-400">
                  供应商实付：
                  {selected.providerCost == null ? "待对账" : `${selected.providerCost} ${selected.currency || ""}`}（{selected.costSource}）
                </dd>
              </div>
            </dl>
            {selected.errorMessage && <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{selected.errorMessage}</div>}
            <h3 className="mb-2 mt-6 text-sm font-semibold">供应商调用与实付</h3>
            <div className="space-y-2">
              {selected.providerAttempts.map((attempt) => (
                <div key={attempt.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex justify-between">
                    <span className="font-medium">
                      {attempt.provider} · {attempt.model || "未提供模型"}
                    </span>
                    <span>
                      {attempt.status} {attempt.httpStatus || ""}
                    </span>
                  </div>
                  <div className="mt-1 break-all font-mono text-xs text-stone-400">
                    {attempt.method} {attempt.endpoint}
                  </div>
                  {attempt.externalTaskId && <div className="mt-1 text-xs">任务 ID：{attempt.externalTaskId}</div>}
                  {attempt.requestId && <div className="mt-1 break-all text-xs">请求 ID：{attempt.requestId}</div>}
                  {attempt.totalTokens != null && (
                    <div className="mt-1 text-xs">
                      Token：{attempt.inputTokens || 0} 输入 + {attempt.outputTokens || 0} 输出 = {attempt.totalTokens}
                    </div>
                  )}
                  <div className="mt-2 flex items-center justify-between gap-3 text-xs">
                    <span>
                      实付：{attempt.providerCost == null ? "待对账" : `${attempt.providerCost} ${attempt.currency || ""}`}（{attempt.costSource}）
                    </span>
                    <button onClick={() => void reconcileCost(attempt)} className="shrink-0 rounded border px-2 py-1 hover:bg-stone-50">
                      录入实付
                    </button>
                  </div>
                  {attempt.errorMessage && <div className="mt-1 text-xs text-red-600">{attempt.errorMessage}</div>}
                </div>
              ))}
              {selected.providerAttempts.length === 0 && <p className="text-sm text-stone-400">没有供应商调用明细；若这是 SVG 等本地任务，应归为平台服务费，否则说明调用链尚未接入追踪。</p>}
            </div>
            <h3 className="mb-2 mt-6 text-sm font-semibold">任务成果</h3>
            <div className="flex flex-wrap gap-2">
              {selected.results.map((result) => (
                <button key={result.id} onClick={() => void openPreview(result)} className="rounded-lg border px-3 py-2 text-sm hover:bg-stone-50">
                  {result.title || result.kind}
                  {result.isMock ? "（兜底）" : ""}
                </button>
              ))}
              {selected.results.length === 0 && <p className="text-sm text-stone-400">该记录没有可关联成果</p>}
            </div>
            {previewLoading && <p className="mt-4 text-sm text-stone-500">正在生成安全预览链接…</p>}
            {preview && <div className="mt-4 overflow-hidden rounded-xl border bg-black/5 p-2">{preview.mimeType.startsWith("image/") ? <img src={preview.url} alt={preview.title || "任务成果"} className="max-h-[60vh] w-full object-contain" /> : preview.mimeType.startsWith("video/") ? <video src={preview.url} controls autoPlay className="max-h-[60vh] w-full" /> : preview.mimeType.startsWith("audio/") ? <audio src={preview.url} controls autoPlay className="w-full" /> : <iframe src={preview.url} title={preview.title || "任务成果"} className="h-[60vh] w-full bg-white" />}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
