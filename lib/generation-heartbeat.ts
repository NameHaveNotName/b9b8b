/**
 * 生成任务心跳
 *
 * 长耗时的生成任务（视频轮询最长 5 分钟、TTS、批量处理）会保持行状态为
 * `generating`。`resetStaleGenerating*` 依赖 `updatedAt` 判断任务是否已死，
 * 但如果任务本身从不刷新 `updatedAt`，一个仍在跑的任务会在超时阈值后被误判为
 * 卡死并翻成 `failed`，随后重试会启动第二个任务，第一个任务的迟到写入还会
 * 覆盖第二个的结果 —— 重复付费且内容不确定。
 *
 * 这里用定时 touch 让存活任务持续刷新 `updatedAt`，让超时清理只作用于真正死掉的任务。
 */

const DEFAULT_INTERVAL_MS = 60_000

export type StopHeartbeat = () => void

/**
 * 启动心跳，定期刷新行的时间戳。
 *
 * @param touch 刷新函数，内部异常会被吞掉：心跳失败不应该中断生成
 * @param intervalMs 刷新间隔，需显著小于调用方的 stale 阈值
 * @returns 停止函数，必须在生成结束（成功或失败）时调用
 */
export function startHeartbeat(
  touch: () => Promise<unknown>,
  intervalMs: number = DEFAULT_INTERVAL_MS
): StopHeartbeat {
  // setInterval 会让 Node 进程/Serverless 实例无法自然退出，必须显式清理
  const timer = setInterval(() => {
    Promise.resolve()
      .then(touch)
      .catch(() => {
        /* 心跳失败不阻断生成主流程 */
      })
  }, intervalMs)

  // unref：不让心跳定时器单独把进程吊住
  if (typeof timer.unref === 'function') timer.unref()

  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    clearInterval(timer)
  }
}
