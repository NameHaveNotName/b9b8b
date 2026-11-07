"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { Loader2, ShieldCheck, Trash2, Users } from "lucide-react";
import { apiClient } from "@/lib/api-client";

const fetcher = (url: string) => apiClient<any>(url);
const ROLE_LABELS: Record<string, string> = {
  OWNER: "系列负责人",
  WRITER: "编剧",
  VISUAL: "视觉",
  EPISODE_EDITOR: "单集编辑",
  REVIEWER: "审核人",
};
const STATUS_LABELS: Record<string, string> = {
  PENDING: "待审核",
  APPROVED: "已批准",
  REJECTED: "已拒绝",
  EXPIRED: "已过期",
  CONSUMED: "已使用",
};

export default function SeriesTeamBudgetPanel({
  seriesId,
  episodes,
}: {
  seriesId: string;
  episodes: any[];
}) {
  const { data, mutate } = useSWR(`/api/series/${seriesId}/team`, fetcher);
  const { data: approvalData, mutate: mutateApprovals } = useSWR(
    `/api/series/${seriesId}/approvals`,
    fetcher,
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [member, setMember] = useState({
    email: "",
    role: "WRITER",
    assignedEpisodeIds: [] as string[],
  });
  const [policy, setPolicy] = useState({
    monthlyPointBudget: "0",
    batchGenerationLimit: "3",
    requireBatchApproval: true,
  });
  const [request, setRequest] = useState({
    episodeIds: [] as string[],
    requestedPoints: "",
    purpose: "",
  });

  useEffect(() => {
    if (data?.policy)
      setPolicy({
        monthlyPointBudget: String(data.policy.monthlyPointBudget),
        batchGenerationLimit: String(data.policy.batchGenerationLimit),
        requireBatchApproval: data.policy.requireBatchApproval,
      });
  }, [data?.policy]);

  async function addMember() {
    setSaving(true);
    setMessage("");
    try {
      await apiClient(`/api/series/${seriesId}/team`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(member),
      });
      setMember({ email: "", role: "WRITER", assignedEpisodeIds: [] });
      await mutate();
      setMessage("成员职责已保存。");
    } catch (error: any) {
      setMessage(error?.message || "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function savePolicy() {
    setSaving(true);
    setMessage("");
    try {
      await apiClient(`/api/series/${seriesId}/team`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "policy",
          monthlyPointBudget: Number(policy.monthlyPointBudget),
          batchGenerationLimit: Number(policy.batchGenerationLimit),
          requireBatchApproval: policy.requireBatchApproval,
        }),
      });
      await mutate();
      setMessage("预算与审批规则已保存。");
    } catch (error: any) {
      setMessage(error?.message || "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function removeMember(memberId: string) {
    setSaving(true);
    setMessage("");
    try {
      await apiClient(`/api/series/${seriesId}/team/${memberId}`, {
        method: "DELETE",
      });
      await mutate();
      setMessage("成员已移出系列。");
    } catch (error: any) {
      setMessage(error?.message || "移除失败");
    } finally {
      setSaving(false);
    }
  }

  async function submitRequest() {
    setSaving(true);
    setMessage("");
    try {
      await apiClient(`/api/series/${seriesId}/approvals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...request,
          requestedPoints: Number(request.requestedPoints),
        }),
      });
      setRequest({ episodeIds: [], requestedPoints: "", purpose: "" });
      await mutateApprovals();
      setMessage("跨集生成申请已提交。");
    } catch (error: any) {
      setMessage(error?.message || "提交失败");
    } finally {
      setSaving(false);
    }
  }

  async function decide(requestId: string, decision: "APPROVED" | "REJECTED") {
    setSaving(true);
    setMessage("");
    try {
      await apiClient(`/api/series/${seriesId}/approvals/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      await mutateApprovals();
      setMessage(
        decision === "APPROVED" ? "申请已批准，有效期 7 天。" : "申请已拒绝。",
      );
    } catch (error: any) {
      setMessage(error?.message || "处理失败");
    } finally {
      setSaving(false);
    }
  }

  const isOwner = data?.role === "OWNER";
  const canRequest = ["OWNER", "WRITER", "VISUAL", "EPISODE_EDITOR"].includes(
    data?.role,
  );
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <div className="flex items-start gap-2">
        <Users className="mt-0.5 h-5 w-5 text-amber-700" />
        <div>
          <h2 className="font-semibold text-stone-900">团队职责与跨集预算</h2>
          <p className="mt-1 text-xs text-stone-500">
            负责人管理职责；跨集生成先申报集数和点数，再由负责人或审核人决定。
          </p>
        </div>
      </div>
      {!data ? (
        <div className="flex h-20 items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-stone-400" />
        </div>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="rounded-lg bg-stone-50 p-3 text-xs text-stone-600">
              <p>本月已用：{data.monthlyPointsUsed} 点</p>
              <p>已批准待使用：{data.monthlyPointsReserved || 0} 点</p>
              <p>
                本月剩余：
                {data.monthlyPointsRemaining === null
                  ? "未设上限"
                  : `${data.monthlyPointsRemaining} 点`}
              </p>
            </div>
            {isOwner && (
              <>
                <div className="grid gap-2 sm:grid-cols-3">
                  <input
                    value={policy.monthlyPointBudget}
                    onChange={(e) =>
                      setPolicy({
                        ...policy,
                        monthlyPointBudget: e.target.value,
                      })
                    }
                    type="number"
                    min={0}
                    placeholder="月预算，0 不限"
                    className="rounded-lg border border-stone-200 px-3 py-2 text-xs"
                  />
                  <input
                    value={policy.batchGenerationLimit}
                    onChange={(e) =>
                      setPolicy({
                        ...policy,
                        batchGenerationLimit: e.target.value,
                      })
                    }
                    type="number"
                    min={1}
                    max={100}
                    placeholder="单批集数"
                    className="rounded-lg border border-stone-200 px-3 py-2 text-xs"
                  />
                  <label className="flex items-center gap-2 rounded-lg border border-stone-200 px-3 py-2 text-xs">
                    <input
                      type="checkbox"
                      checked={policy.requireBatchApproval}
                      onChange={(e) =>
                        setPolicy({
                          ...policy,
                          requireBatchApproval: e.target.checked,
                        })
                      }
                    />
                    需要审批
                  </label>
                </div>
                <button
                  type="button"
                  onClick={savePolicy}
                  disabled={saving}
                  className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-medium text-white"
                >
                  保存预算规则
                </button>
                <div className="border-t border-stone-100 pt-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      value={member.email}
                      onChange={(e) =>
                        setMember({ ...member, email: e.target.value })
                      }
                      placeholder="成员邮箱"
                      className="rounded-lg border border-stone-200 px-3 py-2 text-xs"
                    />
                    <select
                      value={member.role}
                      onChange={(e) =>
                        setMember({
                          ...member,
                          role: e.target.value,
                          assignedEpisodeIds: [],
                        })
                      }
                      className="rounded-lg border border-stone-200 px-3 py-2 text-xs"
                    >
                      {Object.entries(ROLE_LABELS)
                        .filter(([role]) => role !== "OWNER")
                        .map(([role, label]) => (
                          <option key={role} value={role}>
                            {label}
                          </option>
                        ))}
                    </select>
                  </div>
                  {member.role === "EPISODE_EDITOR" && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {episodes.map((episode) => (
                        <label
                          key={episode.id}
                          className="rounded-full border border-stone-200 px-2 py-1 text-[11px]"
                        >
                          <input
                            type="checkbox"
                            className="mr-1"
                            checked={member.assignedEpisodeIds.includes(
                              episode.id,
                            )}
                            onChange={(e) =>
                              setMember({
                                ...member,
                                assignedEpisodeIds: e.target.checked
                                  ? [...member.assignedEpisodeIds, episode.id]
                                  : member.assignedEpisodeIds.filter(
                                      (id) => id !== episode.id,
                                    ),
                              })
                            }
                          />
                          第 {episode.episodeNumber} 集
                        </label>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={addMember}
                    disabled={saving || !member.email}
                    className="mt-2 rounded-lg border border-stone-300 px-3 py-2 text-xs"
                  >
                    添加或更新成员
                  </button>
                </div>
              </>
            )}
            <div className="space-y-2">
              {data.members.map((item: any) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 rounded-lg border border-stone-100 p-2 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-stone-800">
                      {item.user.name || item.user.email}
                    </p>
                    <p className="text-stone-400">
                      {ROLE_LABELS[item.role] || item.role}
                      {Array.isArray(item.assignedEpisodeIds) &&
                      item.assignedEpisodeIds.length
                        ? ` · ${item.assignedEpisodeIds.length} 集`
                        : ""}
                    </p>
                  </div>
                  {isOwner && (
                    <button
                      type="button"
                      onClick={() => removeMember(item.id)}
                      className="text-stone-400 hover:text-red-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <p className="text-xs font-medium text-stone-800">
                申请跨集生成额度
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {episodes.map((episode) => (
                  <label
                    key={episode.id}
                    className="rounded-full border border-stone-200 px-2 py-1 text-[11px]"
                  >
                    <input
                      type="checkbox"
                      className="mr-1"
                      checked={request.episodeIds.includes(episode.id)}
                      onChange={(e) =>
                        setRequest({
                          ...request,
                          episodeIds: e.target.checked
                            ? [...request.episodeIds, episode.id]
                            : request.episodeIds.filter(
                                (id) => id !== episode.id,
                              ),
                        })
                      }
                    />
                    第 {episode.episodeNumber} 集
                  </label>
                ))}
              </div>
              <input
                value={request.requestedPoints}
                onChange={(e) =>
                  setRequest({ ...request, requestedPoints: e.target.value })
                }
                type="number"
                min={1}
                placeholder="预计点数"
                className="mt-2 w-full rounded-lg border border-stone-200 px-3 py-2 text-xs"
              />
              <textarea
                value={request.purpose}
                onChange={(e) =>
                  setRequest({ ...request, purpose: e.target.value })
                }
                placeholder="说明生成范围和用途"
                className="mt-2 min-h-16 w-full rounded-lg border border-stone-200 px-3 py-2 text-xs"
              />
              <button
                type="button"
                onClick={submitRequest}
                disabled={
                  !canRequest ||
                  saving ||
                  request.episodeIds.length === 0 ||
                  !request.requestedPoints ||
                  !request.purpose.trim()
                }
                className="mt-2 rounded-lg bg-amber-700 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
              >
                提交申请
              </button>
            </div>
            <div className="border-t border-stone-100 pt-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-stone-800">
                <ShieldCheck className="h-3.5 w-3.5" />
                最近申请
              </p>
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {(approvalData?.requests || []).map((item: any) => (
                  <div
                    key={item.id}
                    className="rounded-lg border border-stone-100 p-2 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-stone-800">
                        {item.requestedPoints} 点 ·{" "}
                        {Array.isArray(item.episodeIds)
                          ? item.episodeIds.length
                          : 0}{" "}
                        集
                      </p>
                      <span className="text-[10px] text-stone-400">
                        {STATUS_LABELS[item.status] || item.status}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-stone-500">
                      {item.purpose}
                    </p>
                    {approvalData?.canReview && item.status === "PENDING" && (
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => decide(item.id, "APPROVED")}
                          className="rounded bg-emerald-600 px-2 py-1 text-white"
                        >
                          批准
                        </button>
                        <button
                          type="button"
                          onClick={() => decide(item.id, "REJECTED")}
                          className="rounded bg-stone-200 px-2 py-1 text-stone-700"
                        >
                          拒绝
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      {message && (
        <p
          className={`mt-3 text-xs ${message.includes("失败") ? "text-red-600" : "text-emerald-700"}`}
        >
          {message}
        </p>
      )}
    </section>
  );
}
