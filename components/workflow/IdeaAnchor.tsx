import { Anchor } from 'lucide-react'

interface IdeaAnchorProps {
  text: string
}

export default function IdeaAnchor({ text }: IdeaAnchorProps) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100">
          <Anchor className="h-4 w-4 text-amber-600" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-amber-700">原始灵感锚点</p>
          <p className="mt-1 text-sm leading-relaxed text-amber-800">
            <span className="text-amber-400">"</span>
            {text}
            <span className="text-amber-400">"</span>
          </p>
          <p className="mt-2 text-[11px] text-amber-600/70">
            系统将始终保留你的原始灵感，所有扩展都基于此锚点
          </p>
        </div>
      </div>
    </div>
  )
}
