import { type ReactNode } from 'react'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}

export default function EmptyState({
  icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 bg-stone-50 py-20">
      {icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-stone-100 text-stone-400">
          {icon}
        </div>
      )}
      <p className="mt-4 text-sm font-medium text-stone-600">{title}</p>
      {description && (
        <p className="mt-1 text-xs text-stone-400">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
