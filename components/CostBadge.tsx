interface CostBadgeProps {
  cost?: number
  showFree?: boolean
}

export default function CostBadge({ cost = 0, showFree = true }: CostBadgeProps) {
  if (cost === 0 && !showFree) return null

  return (
    <span className="absolute -top-3.5 -right-2 text-[10px] text-gray-400 bg-transparent whitespace-nowrap">
      {cost === 0 ? '免费' : `-${cost} 点`}
    </span>
  )
}
