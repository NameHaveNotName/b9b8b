"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ArrowLeft, ExternalLink, Loader2, Plus } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import EpisodeContinuityPanel from "./_components/EpisodeContinuityPanel";
import SeriesBibleEditor from "./_components/SeriesBibleEditor";
import EpisodeBibleUpgradeButton from "./_components/EpisodeBibleUpgradeButton";
import SeriesAssetManager from "./_components/SeriesAssetManager";
import BatchEpisodeCreator from "./_components/BatchEpisodeCreator";
import SeriesConsistencyPanel from "./_components/SeriesConsistencyPanel";
import EpisodeDetachButton from "./_components/EpisodeDetachButton";
import SeriesTeamBudgetPanel from "./_components/SeriesTeamBudgetPanel";

const fetcher = (url: string) => apiClient<any>(url);

export default function SeriesDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data, mutate, isLoading } = useSWR(`/api/series/${id}`, fetcher);
  const { data: projectsData } = useSWR("/api/projects", fetcher);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mode, setMode] = useState<"NEW" | "EXISTING">("NEW");
  const series = data?.series;
  const nextNumber = useMemo(
    () =>
      Math.max(
        0,
        ...(series?.episodes || []).map((item: any) => item.episodeNumber || 0),
      ) + 1,
    [series],
  );
  const [form, setForm] = useState({
    episodeNumber: "",
    title: "",
    synopsis: "",
    projectId: "",
  });
  const bible = series?.bibleRevisions?.[0];
  const accessRole = series?.accessRole || "OWNER";
  const canWrite = accessRole === "OWNER" || accessRole === "WRITER";
  const canManageAssets = accessRole === "OWNER" || accessRole === "VISUAL";
  const assignedEpisodeIds = Array.isArray(series?.assignedEpisodeIds)
    ? series.assignedEpisodeIds
    : [];
  const canEditContinuity = (episodeId: string) =>
    canWrite ||
    (accessRole === "EPISODE_EDITOR" && assignedEpisodeIds.includes(episodeId));
  const canReadEpisodeProject = (episodeId: string) =>
    accessRole !== "EPISODE_EDITOR" || assignedEpisodeIds.includes(episodeId);

  async function createEpisode(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const selectedProject = (projectsData?.projects || []).find(
      (item: any) => item.id === form.projectId,
    );
    try {
      const result = await apiClient<{
        continuityWarning?: string | null;
        inheritedSeriesAssetCount?: number;
      }>(`/api/series/${id}/episodes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          episodeNumber: Number(form.episodeNumber || nextNumber),
          title: form.title.trim() || selectedProject?.title,
          synopsis: form.synopsis,
          projectId: mode === "EXISTING" ? form.projectId : undefined,
        }),
      });
      setForm({ episodeNumber: "", title: "", synopsis: "", projectId: "" });
      setShowCreate(false);
      await mutate();
      const assetNote = result.inheritedSeriesAssetCount
        ? `，并复制了 ${result.inheritedSeriesAssetCount} 项系列公共资产`
        : "";
      setNotice(
        result.continuityWarning === "PREVIOUS_CONTINUITY_MISSING"
          ? `本集已创建${assetNote}，但上一集尚未填写连续性账本。`
          : `本集已创建，并已固定系列圣经与上一集连续性快照${assetNote}。`,
      );
    } catch (err: any) {
      setError(err?.message || "创建单集失败");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading)
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-stone-400" />
      </div>
    );
  if (!series)
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
        系列不存在或无权访问。
      </div>
    );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link
        href="/series"
        className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-800"
      >
        <ArrowLeft className="h-4 w-4" />
        返回系列列表
      </Link>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">{series.title}</h1>
          <p className="mt-1 text-sm text-stone-500">
            {series.logline || "尚未填写一句话定位"}
          </p>
        </div>
        {canWrite && (
          <button
            onClick={() => setShowCreate((value) => !value)}
            className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white"
          >
            <Plus className="h-4 w-4" />
            添加一集
          </button>
        )}
      </div>

      {canWrite && (
        <SeriesBibleEditor
          seriesId={id}
          title={series.title}
          version={bible?.revisionNumber || series.currentBibleVersion}
          payload={bible?.payload}
          onUpdated={() => mutate()}
        />
      )}
      {canManageAssets && <SeriesAssetManager seriesId={id} />}
      {canWrite && (
        <BatchEpisodeCreator
          seriesId={id}
          nextNumber={nextNumber}
          onCreated={() => mutate()}
        />
      )}
      <SeriesConsistencyPanel seriesId={id} />
      <SeriesTeamBudgetPanel seriesId={id} episodes={series.episodes} />

      {canWrite && showCreate && (
        <form
          onSubmit={createEpisode}
          className="rounded-2xl border border-amber-200 bg-amber-50/40 p-5"
        >
          <h2 className="font-semibold text-stone-900">添加单集项目</h2>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setMode("NEW")}
              className={`rounded-lg px-3 py-2 text-xs ${mode === "NEW" ? "bg-stone-900 text-white" : "border border-stone-200 bg-white text-stone-600"}`}
            >
              新建九步项目
            </button>
            <button
              type="button"
              onClick={() => setMode("EXISTING")}
              className={`rounded-lg px-3 py-2 text-xs ${mode === "EXISTING" ? "bg-stone-900 text-white" : "border border-stone-200 bg-white text-stone-600"}`}
            >
              关联已有项目
            </button>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-[120px_1fr]">
            {" "}
            <input
              type="number"
              min={1}
              max={999}
              value={form.episodeNumber}
              onChange={(e) =>
                setForm({ ...form, episodeNumber: e.target.value })
              }
              placeholder={`第 ${nextNumber} 集`}
              className="rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm"
            />
            {mode === "EXISTING" ? (
              <select
                value={form.projectId}
                onChange={(e) =>
                  setForm({ ...form, projectId: e.target.value })
                }
                required
                className="rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm"
              >
                <option value="">选择已有项目</option>
                {(projectsData?.projects || []).map((project: any) => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
                placeholder="本集标题"
                className="rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm"
              />
            )}
          </div>
          <textarea
            value={form.synopsis}
            onChange={(e) => setForm({ ...form, synopsis: e.target.value })}
            placeholder="本集梗概；会作为本集项目的初始创作锚点"
            className="mt-3 min-h-24 w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm"
          />
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          <div className="mt-3 flex justify-end">
            <button
              disabled={
                saving ||
                (mode === "NEW" ? !form.title.trim() : !form.projectId)
              }
              className="inline-flex items-center gap-2 rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}确认添加
            </button>
          </div>
        </form>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-stone-900">单集制作</h2>
          <span className="text-xs text-stone-400">
            {series.episodes.length} 集
          </span>
        </div>
        {notice && (
          <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {notice}
          </p>
        )}
        {series.episodes.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-stone-300 py-12 text-center text-sm text-stone-400">
            尚未添加单集
          </div>
        ) : (
          <div className="space-y-3">
            {series.episodes.map((episode: any) => (
              <div
                key={episode.id}
                className="overflow-visible rounded-xl border border-stone-200 bg-white"
              >
                <div className="flex items-center gap-4 p-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-sm font-bold text-amber-800">
                    {episode.episodeNumber}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-stone-900">
                      {episode.title}
                    </p>
                    <p className="mt-0.5 text-xs text-stone-500">
                      第 {episode.season.seasonNumber} 季 · 圣经 v
                      {episode.bibleRevision.revisionNumber} ·{" "}
                      {episode.continuityBefore
                        ? "已继承连续性快照"
                        : "无上一集快照"}
                    </p>
                  </div>
                  {canWrite && (
                    <EpisodeBibleUpgradeButton
                      seriesId={id}
                      episodeId={episode.id}
                      currentVersion={episode.bibleRevision.revisionNumber}
                      targetVersion={series.currentBibleVersion}
                      onUpgraded={() => mutate()}
                    />
                  )}
                  {canReadEpisodeProject(episode.id) && (
                    <Link
                      href={`/project/${episode.project.id}`}
                      className="inline-flex items-center gap-1 rounded-lg border border-stone-200 px-3 py-2 text-xs font-medium text-stone-700 hover:bg-stone-50"
                    >
                      查看项目
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  )}
                  {accessRole === "OWNER" && (
                    <EpisodeDetachButton
                      seriesId={id}
                      episodeId={episode.id}
                      onDetached={() => {
                        setNotice(
                          "已退出系列；原项目、已有成果和全部快照仍保留，可从项目列表继续打开。",
                        );
                        mutate();
                      }}
                    />
                  )}
                </div>
                {canEditContinuity(episode.id) && (
                  <EpisodeContinuityPanel
                    seriesId={id}
                    episode={episode}
                    onSaved={() => mutate()}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
