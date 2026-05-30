import { Zap } from 'lucide-react'

interface CostBadgeProps {
  cost?: number
  showFree?: boolean
}

export default function CostBadge({ cost = 0, showFree = true }: CostBadgeProps) {
  if (cost === 0 && !showFree) return null

  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
        cost === 0
          ? 'bg-green-50 text-green-600'
          : 'bg-amber-50 text-amber-600'
      }`}
    >
      <Zap className="h-2.5 w-2.5" />
      {cost === 0 ? '免费' : `${cost} 点`}
    </span>
  )
}
