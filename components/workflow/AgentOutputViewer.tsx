type JsonRecord = Record<string, unknown>

const FIELD_LABELS: Record<string, string> = {
  title: '方案标题', summary: '结论摘要', audience: '目标受众', platform: '发布平台', contentType: '内容类型',
  primaryOutcome: '首要目标', hardConstraints: '硬性约束', successCriteria: '成功标准', verificationNeeded: '发布前待核验',
  narrativeSubjectCandidates: '叙事主体候选', mustShow: '必须呈现', mustAvoid: '必须避免', platformFit: '平台适配',
  evidenceGaps: '证据缺口', audienceInsight: '受众洞察', evaluationRubric: '评判标准', narrativeOpportunity: '叙事机会',
  communicationPriority: '传播优先级', conflicts: '冲突与取舍', factualRisks: '事实风险', recommendation: '评审建议',
  candidateScores: '候选评分', productionRisks: '制作风险', strongestElements: '值得保留的亮点', reason: '理由', decision: '决策',
  assumptions: '当前假设', minimumReleaseGate: '最低发布门槛', centralIdea: '核心创意', storyApproach: '故事方案',
  requiredAssets: '所需素材', narrativeSubject: '叙事主体', factualGuardrails: '事实与合规红线', userDecisionPoints: '需要你确认的事项',
  audienceAndPlatform: '受众与平台策略', audiovisualApproach: '视听方案', keyBeats: '叙事节拍', beat: '节点', content: '内容', evidence: '判断依据',
  risk: '风险', severity: '等级', mitigation: '应对方式', impact: '影响', recommendedDefault: '建议默认项', options: '可选项',
  direction: '主方向', scope: '范围', opening: '开场', fallback: '备选方案', productFraming: '产品呈现方式',
  conflictProgression: '冲突推进', visual: '画面', purpose: '作用', dialogue: '台词', primary: '主要主体', secondary: '辅助主体',
  contentObjects: '贯穿内容对象', subject: '对象', function: '叙事作用', status: '当前状态', mustFollow: '必须遵守',
  permittedFraming: '允许的表达', prohibitedFraming: '禁止的表达', contentForm: '内容形式', audienceValue: '观众价值',
  preferredAction: '建议行动引导', labelSystem: '画面标签系统', toolVisuals: '工具画面', overallStyle: '整体风格',
  brandTreatment: '品牌处理', painPointVisuals: '痛点画面', editingPrinciples: '剪辑原则', storyAssets: '故事素材',
  screenRecording: '录屏素材', audioAndGraphics: '声音与图形', complianceMaterials: '合规材料', pptsAndTestMaterials: 'PPT与测试材料',
  findings: '研究结论', sources: '资料来源', copyrightStatus: '版权状态', url: '链接', publishedAt: '发布时间', note: '备注',
  'subject-facts': '主体与事实研究', 'audience-context': '平台与受众研究', 'audiovisual-form': '视听形式研究',
}

const SEVERITY_LABELS: Record<string, string> = { critical: '严重', high: '高', medium: '中', low: '低' }
const SEVERITY_STYLES: Record<string, string> = {
  critical: 'border-red-200 bg-red-50 text-red-700',
  high: 'border-orange-200 bg-orange-50 text-orange-700',
  medium: 'border-amber-200 bg-amber-50 text-amber-700',
  low: 'border-blue-200 bg-blue-50 text-blue-700',
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function labelFor(key: string) {
  return FIELD_LABELS[key] || key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, value => value.toUpperCase())
}

function safeHttpUrl(value: unknown) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null
  } catch { return null }
}

function displayPrimitive(value: unknown) {
  if (value === true) return '是'
  if (value === false) return '否'
  if (value == null) return '暂无'
  return String(value)
}

function PrimitiveList({ items, ordered = false }: { items: unknown[]; ordered?: boolean }) {
  const List = ordered ? 'ol' : 'ul'
  return (
    <List className={`space-y-2 ${ordered ? 'list-decimal' : 'list-disc'} pl-5 text-sm leading-6 text-stone-700 marker:text-amber-600`}>
      {items.map((item, index) => <li key={index}>{displayPrimitive(item)}</li>)}
    </List>
  )
}

function ObjectCard({ value, index, depth }: { value: JsonRecord; index: number; depth: number }) {
  const headingKey = ['title', 'beat', 'risk', 'decision', 'subject', 'label', 'name'].find(key => typeof value[key] === 'string')
  const severity = typeof value.severity === 'string' ? value.severity.toLowerCase() : ''
  return (
    <article className="rounded-xl border border-stone-200 bg-white p-3.5 shadow-sm shadow-stone-100/60">
      <div className="mb-2 flex items-start gap-2">
        <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-amber-50 px-1.5 text-[11px] font-bold text-amber-700">{index + 1}</span>
        <h5 className="flex-1 text-sm font-semibold leading-6 text-stone-800">{headingKey ? displayPrimitive(value[headingKey]) : `条目 ${index + 1}`}</h5>
        {severity && <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${SEVERITY_STYLES[severity] || 'border-stone-200 bg-stone-50 text-stone-600'}`}>{SEVERITY_LABELS[severity] || severity}</span>}
      </div>
      <div className="space-y-2.5 pl-8">
        {Object.entries(value).filter(([key]) => key !== headingKey && key !== 'severity').map(([key, item]) => (
          <FieldValue key={key} fieldKey={key} value={item} depth={depth + 1} compact />
        ))}
      </div>
    </article>
  )
}

function FieldValue({ fieldKey, value, depth = 0, compact = false }: { fieldKey: string; value: unknown; depth?: number; compact?: boolean }) {
  const label = labelFor(fieldKey)
  const link = fieldKey === 'url' ? safeHttpUrl(value) : null
  if (link) {
    return <div className="text-xs"><span className="mr-2 font-medium text-stone-500">{label}</span><a href={link} target="_blank" rel="noreferrer" className="break-all text-blue-600 hover:underline">打开来源 ↗</a></div>
  }
  if (!isRecord(value) && !Array.isArray(value)) {
    return (
      <div className={compact ? 'grid gap-0.5 sm:grid-cols-[7.5rem_1fr]' : ''}>
        <p className="text-xs font-semibold text-stone-500">{label}</p>
        <p className="whitespace-pre-wrap text-sm leading-6 text-stone-700">{displayPrimitive(value)}</p>
      </div>
    )
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return null
    const primitives = value.every(item => !isRecord(item) && !Array.isArray(item))
    return (
      <section className="space-y-2">
        <div className="flex items-center gap-2"><h4 className="text-xs font-semibold text-stone-600">{label}</h4><span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] text-stone-500">{value.length} 项</span></div>
        {primitives
          ? <PrimitiveList items={value} ordered={fieldKey === 'conflictProgression'} />
          : <div className="grid gap-2.5">{value.map((item, index) => isRecord(item)
            ? <ObjectCard key={index} value={item} index={index} depth={depth} />
            : <div key={index} className="rounded-lg bg-stone-50 p-3"><ReadableValue value={item} depth={depth + 1} /></div>)}</div>}
      </section>
    )
  }
  const entries = Object.entries(value)
  if (!entries.length) return null
  return (
    <section className={`space-y-2 ${depth > 1 ? 'rounded-lg bg-stone-50 p-3' : ''}`}>
      <h4 className="text-xs font-semibold text-stone-600">{label}</h4>
      <div className="space-y-3">{entries.map(([key, item]) => <FieldValue key={key} fieldKey={key} value={item} depth={depth + 1} compact={depth > 0} />)}</div>
    </section>
  )
}

function ReadableValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (Array.isArray(value)) {
    if (value.every(item => !isRecord(item) && !Array.isArray(item))) return <PrimitiveList items={value} />
    return <div className="space-y-2">{value.map((item, index) => isRecord(item) ? <ObjectCard key={index} value={item} index={index} depth={depth} /> : <ReadableValue key={index} value={item} depth={depth + 1} />)}</div>
  }
  if (isRecord(value)) return <div className="space-y-4">{Object.entries(value).map(([key, item]) => <FieldValue key={key} fieldKey={key} value={item} depth={depth} />)}</div>
  return <p className="whitespace-pre-wrap text-sm leading-6 text-stone-700">{displayPrimitive(value)}</p>
}

function PlanOverview({ plan }: { plan: JsonRecord }) {
  const story = isRecord(plan.storyApproach) ? plan.storyApproach : {}
  const audience = isRecord(plan.audienceAndPlatform) ? plan.audienceAndPlatform : {}
  const subject = isRecord(plan.narrativeSubject) && isRecord(plan.narrativeSubject.primary) ? plan.narrativeSubject.primary : {}
  const quickFacts = ([
    ['主创意方向', story.direction],
    ['主要叙事主体', subject.subject],
    ['目标受众', audience.audience],
    ['平台与形式', [audience.platform, audience.contentForm].filter(Boolean).join(' · ')],
    ['建议行动引导', audience.preferredAction],
  ] as Array<[string, unknown]>).filter(([, value]) => Boolean(value))
  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50 p-5">
        <p className="text-[11px] font-semibold tracking-widest text-amber-700">完整创作方案</p>
        <h3 className="mt-2 text-lg font-bold leading-7 text-stone-900">{displayPrimitive(plan.title || '未命名方案')}</h3>
        <p className="mt-3 text-sm leading-7 text-stone-700">{displayPrimitive(plan.summary)}</p>
      </section>

      {typeof plan.centralIdea === 'string' && <section className="rounded-xl border-l-4 border-amber-500 bg-amber-50/60 p-4"><p className="text-xs font-semibold text-amber-800">一句话判断这个方案</p><p className="mt-2 text-sm font-medium leading-7 text-stone-800">{plan.centralIdea}</p></section>}

      {quickFacts.length > 0 && <section><h4 className="mb-2 text-sm font-semibold text-stone-800">审核速览</h4><div className="grid gap-2 sm:grid-cols-2">{quickFacts.map(([label, value]) => <div key={String(label)} className="rounded-xl border border-stone-200 bg-white p-3"><p className="text-[11px] font-semibold text-stone-400">{label}</p><p className="mt-1 text-sm leading-6 text-stone-700">{displayPrimitive(value)}</p></div>)}</div></section>}

      {Array.isArray(plan.keyBeats) && <section><h4 className="mb-3 text-sm font-semibold text-stone-800">故事如何展开</h4><div className="space-y-0">{plan.keyBeats.map((item, index) => { const beat = isRecord(item) ? item : {}; return <div key={index} className="grid grid-cols-[30px_1fr] gap-3"><div className="flex flex-col items-center"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-stone-900 text-xs font-bold text-white">{index + 1}</span>{index < (plan.keyBeats as unknown[]).length - 1 && <span className="min-h-8 w-px flex-1 bg-stone-200" />}</div><div className="pb-4"><p className="text-sm font-semibold text-stone-800">{displayPrimitive(beat.beat)}</p><p className="mt-1 text-sm leading-6 text-stone-700">{displayPrimitive(beat.content)}</p>{beat.evidence != null && <p className="mt-1 text-xs leading-5 text-stone-500"><span className="font-semibold">判断依据：</span>{displayPrimitive(beat.evidence)}</p>}</div></div>})}</div></section>}

      {Array.isArray(plan.productionRisks) && <FieldValue fieldKey="productionRisks" value={plan.productionRisks} />}
      {Array.isArray(plan.userDecisionPoints) && <FieldValue fieldKey="userDecisionPoints" value={plan.userDecisionPoints} />}
      {isRecord(plan.factualGuardrails) && <FieldValue fieldKey="factualGuardrails" value={plan.factualGuardrails} />}
      {Array.isArray(plan.verificationNeeded) && <FieldValue fieldKey="verificationNeeded" value={plan.verificationNeeded} />}

      <details className="rounded-xl border border-stone-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold text-stone-700">展开制作素材、完整故事方案与视听细节</summary>
        <div className="mt-4 space-y-5 border-t border-stone-100 pt-4">
          {['storyApproach', 'requiredAssets', 'narrativeSubject', 'audienceAndPlatform', 'audiovisualApproach', 'assumptions'].map(key => plan[key] != null && <FieldValue key={key} fieldKey={key} value={plan[key]} />)}
        </div>
      </details>
    </div>
  )
}

export default function AgentOutputViewer({ stageId, output }: { stageId: string; output: unknown }) {
  const isPlan = stageId === 'creative-plan' && isRecord(output)
  return (
    <div className="space-y-3">
      {isPlan ? <PlanOverview plan={output} /> : <ReadableValue value={output} />}
      <details className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
        <summary className="cursor-pointer text-[11px] font-medium text-stone-500">技术信息：查看原始 JSON</summary>
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-stone-950 p-3 text-[11px] leading-relaxed text-stone-200">{JSON.stringify(output, null, 2)}</pre>
      </details>
    </div>
  )
}
