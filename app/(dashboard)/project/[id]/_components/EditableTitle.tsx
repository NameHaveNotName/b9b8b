'use client'

import { useState } from 'react'
import { Pencil, Check, X } from 'lucide-react'

interface EditableTitleProps {
  projectId: string
  initialTitle: string
}

export default function EditableTitle({ projectId, initialTitle }: EditableTitleProps) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(initialTitle)
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!title.trim() || title === initialTitle) {
      setEditing(false)
      if (!title.trim()) setTitle(initialTitle)
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim() }),
      })
      if (!res.ok) throw new Error('保存失败')
      setEditing(false)
    } catch {
      setTitle(initialTitle)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') {
              setEditing(false)
              setTitle(initialTitle)
            }
          }}
          className="rounded-md border border-stone-300 px-2 py-1 text-2xl font-bold text-stone-800 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
          autoFocus
        />
        <button
          onClick={save}
          disabled={saving}
          className="rounded-md p-1 text-green-600 hover:bg-green-50"
        >
          <Check className="h-4 w-4" />
        </button>
        <button
          onClick={() => {
            setEditing(false)
            setTitle(initialTitle)
          }}
          className="rounded-md p-1 text-stone-400 hover:bg-stone-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 group">
      <h1 className="text-2xl font-bold text-stone-800">{title}</h1>
      <button
        onClick={() => setEditing(true)}
        className="rounded-md p-1 text-stone-300 opacity-0 transition hover:bg-stone-100 hover:text-stone-500 group-hover:opacity-100"
      >
        <Pencil className="h-4 w-4" />
      </button>
    </div>
  )
}
