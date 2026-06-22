interface StepBadgeProps {
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'SKIPPED'
}

const STYLES: Record<string, string> = {
  PENDING: 'bg-stone-100 text-stone-500 border-stone-200',
  PROCESSING: 'bg-blue-50 text-blue-600 border-blue-200',
  COMPLETED: 'bg-green-50 text-green-600 border-green-200',
  FAILED: 'bg-red-50 text-red-600 border-red-200',
  SKIPPED: 'bg-stone-100 text-stone-400 border-stone-200',
}

const LABELS: Record<string, string> = {
  PENDING: '待开始',
  PROCESSING: '进行中',
  COMPLETED: '已完成',
  FAILED: '失败',
  SKIPPED: '已跳过',
}

export default function StepBadge({ status }: StepBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${STYLES[status] || STYLES.PENDING}`}
    >
      {LABELS[status] || status}
    </span>
  )
}
