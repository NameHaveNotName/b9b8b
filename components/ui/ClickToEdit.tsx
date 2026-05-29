'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'

interface ClickToEditProps {
  value: string
  onSave: (newValue: string) => void
  multiline?: boolean
  className?: string
  placeholder?: string
}

export function ClickToEdit({ value, onSave, multiline = true, className, placeholder }: ClickToEditProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(value)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 进入编辑状态时聚焦并调整高度
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus()
      // 将光标移到末尾
      const len = editValue.length
      textareaRef.current.setSelectionRange(len, len)
      // 自适应高度
      adjustHeight(textareaRef.current)
    }
  }, [isEditing])

  // 自适应高度函数
  const adjustHeight = useCallback((el: HTMLTextAreaElement) => {
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [])

  const handleBlur = () => {
    setIsEditing(false)
    if (editValue !== value) {
      onSave(editValue)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setEditValue(value) // 取消编辑，恢复原值
      setIsEditing(false)
    }
    if (e.key === 'Enter' && !e.shiftKey && !multiline) {
      e.preventDefault()
      handleBlur()
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditValue(e.target.value)
    adjustHeight(e.target)
  }

  if (isEditing) {
    return (
      <textarea
        ref={textareaRef}
        value={editValue}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className={cn(
          "w-full resize-none border rounded-md p-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-black/10 bg-white",
          className
        )}
        style={{ minHeight: '40px', maxHeight: '300px' }}
        placeholder={placeholder}
      />
    )
  }

  return (
    <div
      onClick={() => setIsEditing(true)}
      className={cn(
        "cursor-text hover:bg-stone-50 rounded-md p-1 -m-1 transition-colors group",
        !value && "text-stone-400 italic",
        className
      )}
      title="点击编辑"
    >
      <span className="group-hover:underline decoration-dotted underline-offset-2">
        {value || placeholder || '点击编辑...'}
      </span>
    </div>
  )
}
