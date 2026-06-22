with open(r'D:\.pogget\user_storage\u_461180\b9b8b\app\(dashboard)\project\[id]\workflow\page.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_return = '''  // 从 prompts 按 actNumber 分组，展示每幕的生成状态和按钮
  const outputData = (step.outputData as any) || {}
  const prompts: any[] = (outputData.prompts || []).map((p: any, i: number) => ({ ...p, _idx: i }))
  const actNumberSet = new Set(prompts.map((p: any) => p.actNumber))
  const actNumbers = Array.from(actNumberSet).sort((a, b) => a - b)

  // 提取每幕已有图片（按 sceneIndex 索引）
  const assetIndexMap: Record<number, Record<number, any>> = {}
  for (const asset of assets) {
    const act = asset.metadata?.actNumber ?? 0
    const idx = asset.metadata?.sceneIndex ?? 0
    if (!assetIndexMap[act]) assetIndexMap[act] = {}
    assetIndexMap[act][idx] = asset
  }

  const defaultRatio = outputData.aspectRatio || '16:9'
  const defaultModel = outputData.imageModel || IMAGE_MODELS.primary

  return (
    <div className="space-y-6">
      {actNumbers.map((actNumber: number) => {
        const actImages = assetIndexMap[actNumber] || {}
        const actPrompts = prompts.filter((p: any) => p.actNumber === actNumber)
        const isGeneratingThisAct = generatingAct === actNumber
        const hasAnyImage = Object.keys(actImages).length > 0
        return (
          <div key={actNumber}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-stone-700">
                第 {actNumber} 幕
              </h3>
              <button
                onClick={() => triggerActGenerate(actNumber, defaultRatio, defaultModel)}
                disabled={isGeneratingThisAct || isExecuting}
                className="flex items-center gap-1.5 rounded-md bg-stone-800 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-stone-700 disabled:opacity-50"
              >
                {isGeneratingThisAct ? (
                  <>
                    <LoaderCircle className="h-3 w-3 animate-spin" />
                    生成中...
                  </>
                ) : (
                  <>
                    <Play className="h-3 w-3" />
                    {hasAnyImage ? '追加生成' : '生成'}
                  </>
                )}
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {actPrompts.map((promptItem: any) => {
                const asset = actImages[promptItem._idx]
                if (!asset) {
                  return (
                    <div key={promptItem._idx} className="group relative overflow-hidden rounded-lg border border-dashed border-stone-300 bg-stone-50">
                      <div className="relative flex w-full flex-col items-center justify-center" style={{ aspectRatio: defaultRatio }}>
                        <span className="text-xs text-stone-400">待生成</span>
                        <span className="mt-1 max-w-[90%] truncate px-2 text-xs text-stone-400">
                          {promptItem.sceneDesc?.slice(0, 50) || promptItem.englishPrompt?.slice(0, 50)}
                        </span>
                      </div>
                    </div>
                  )
                }
                const isRegenerating = regeneratingId === asset.id
                const cardRatio = asset.metadata?.aspectRatio || '16:9'
                const cardModel = asset.metadata?.imageModel || IMAGE_MODELS.primary
                return (
                  <div key={asset.id} className="group relative overflow-hidden rounded-lg border border-stone-200">
                    <div className="relative w-full bg-stone-100 transition-all duration-300" style={{ aspectRatio: ratios[asset.id] || 1.78 }}>
                      <HoverImageBadge
                        src={asset.url}
                        alt={asset.metadata?.sceneDesc}
                        aspectRatio={cardRatio}
                        imageModel={cardModel}
                        isMock={!!asset.metadata?.isMock}
                        onRegenerate={(ar, model) => handleRegenerate(asset.id, ar, model)}
                        isRegenerating={isRegenerating}
                        anyRegenerating={!!regeneratingId}
                        onLoad={(w, h) => setRatios(prev => ({ ...prev, [asset.id]: w / h }))}
                        wrapperClassName="absolute inset-0"
                      />
                    </div>
                    <p className="p-3 text-xs text-stone-500">
                      {asset.metadata?.sceneDesc || asset.metadata?.llmPrompt?.slice(0, 60)}
                    </p>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* 整体重做 */}
      {step.status === 'COMPLETED' && assets.length > 0 && (
        <div className="pt-4 border-t border-stone-100">
          {!showConfirmAll ? (
            <button
              onClick={() => setShowConfirmAll(true)}
              disabled={isExecuting}
              className="flex items-center justify-center gap-2 w-full rounded-lg border border-stone-200 bg-white px-4 py-2.5 text-sm font-medium text-stone-600 transition hover:bg-stone-50 hover:text-stone-800 disabled:opacity-50"
            >
              <RefreshCw className="h-4 w-4" />
              重新生成全部概念图
            </button>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-medium text-stone-800">
                确定要重新生成全部 {assets.length} 张概念图吗？
              </p>
              <p className="mt-1 text-xs text-stone-500">
                这会覆盖现有内容，此操作不可撤销。
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => setShowConfirmAll(false)}
                  className="rounded-md border border-stone-200 bg-white px-4 py-1.5 text-sm text-stone-600 transition hover:bg-stone-50"
                >
                  取消
                </button>
                <div className="relative inline-block">
                  <button
                    onClick={handleRegenerateAll}
                    disabled={isExecuting}
                    className="flex items-center gap-1.5 rounded-md bg-amber-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-amber-700 disabled:opacity-50"
                  >
                    {isExecuting ? (
                      <>
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                        生成中...
                      </>
                    ) : (
                      '确认重做'
                    )}
                  </button>
                  <CostBadge cost={DEFAULT_GENERATE_COST} />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
'''

# Original structure (0-indexed):
# 3407: '' (empty before return)
# 3408: '  return ('
# ... JSX ...
# 3502: '  );'
# 3503: '}'   <- ConceptPanel function close
# 3504: ''    <- empty
# 3505: '/* ============================================================'  <- StoryboardMockImage
#
# new_return ends with closing '}' for the function
# Keep lines[:3407] (before return), new_return, lines[3504:] (StoryboardMockImage onwards)

new_lines = lines[:3407] + [new_return + '\n'] + lines[3504:]

with open(r'D:\.pogget\user_storage\u_461180\b9b8b\app\(dashboard)\project\[id]\workflow\page.tsx', 'w', encoding='utf-8', newline='\n') as f:
    f.writelines(new_lines)
print('Done, total lines:', len(new_lines))