'use client'

import { useState, useCallback } from 'react'
import { X, Upload, Check, Loader2, Diamond } from 'lucide-react'

const PRESET_PACKAGES = [
  { label: '体验包', points: 100, price: 100 }, // 1元 = 100分
  { label: '标准包', points: 500, price: 500 },
  { label: '进阶包', points: 1000, price: 1000 },
]

const BANK_INFO = {
  bank: '中国农业银行',
  name: process.env.NEXT_PUBLIC_RECHARGE_ACCOUNT_NAME || '（请联系管理员配置收款账户）',
  cardNo: process.env.NEXT_PUBLIC_RECHARGE_CARD_NO || '',
  tip: '转账时请备注你的邮箱或昵称，便于核对',
}

interface RechargeModalProps {
  currentPoints: number
  onClose: () => void
  onSuccess: (newPoints: number) => void
}

export default function RechargeModal({ currentPoints, onClose, onClose: _onClose, onSuccess }: RechargeModalProps) {
  const [selectedPkg, setSelectedPkg] = useState<number | null>(null)
  const [customAmount, setCustomAmount] = useState<string>('')
  const [step, setStep] = useState<'select' | 'pay' | 'submitting' | 'done'>('select')
  const [proofFile, setProofFile] = useState<File | null>(null)
  const [proofPreview, setProofPreview] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedPrice = selectedPkg !== null ? PRESET_PACKAGES[selectedPkg].price : null
  const customPrice = customAmount ? Math.round(parseFloat(customAmount) * 100) : null
  const finalPrice = selectedPrice ?? customPrice ?? 0
  const finalPoints = selectedPkg !== null ? PRESET_PACKAGES[selectedPkg].points : (customPrice ?? 0)

  const handleSelectPkg = (idx: number) => {
    setSelectedPkg(idx)
    setCustomAmount('')
  }

  const handleCustomChange = (val: string) => {
    setCustomAmount(val)
    setSelectedPkg(null)
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }, [])

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
  }

  const processFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('请上传图片文件（jpg/png）')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('图片大小不能超过 5MB')
      return
    }
    setError(null)
    setProofFile(file)
    const reader = new FileReader()
    reader.onload = () => setProofPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  const handleConfirm = () => {
    if (finalPrice <= 0) return
    setStep('pay')
  }

  const handleSubmit = async () => {
    if (!proofFile || finalPrice <= 0) return
    setStep('submitting')
    setError(null)

    try {
      const formData = new FormData()
      formData.append('amountYuan', String(finalPrice))
      formData.append('points', String(finalPoints))
      formData.append('proof', proofFile)

      const res = await fetch('/api/recharge', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.message || '提交失败')
      }
      setStep('done')
    } catch (e: any) {
      setError(e.message || '提交失败，请重试')
      setStep('pay')
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <div className="relative w-full max-w-md rounded-xl border border-stone-200 bg-white shadow-xl">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-stone-100 px-5 py-4">
          <h3 className="text-base font-semibold text-stone-800">
            {step === 'done' ? '提交成功' : '充值点数'}
          </h3>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-stone-400 transition hover:bg-stone-100 hover:text-stone-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          {step === 'done' ? (
            <div className="py-6 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-50">
                <Check className="h-6 w-6 text-green-500" />
              </div>
              <p className="text-sm font-medium text-stone-700">充值申请已提交</p>
              <p className="mt-1 text-xs text-stone-500">
                审核通过后点数将自动到账
              </p>
              <button
                onClick={onClose}
                className="mt-4 rounded-lg bg-stone-900 px-5 py-2 text-sm font-medium text-white transition hover:bg-stone-800"
              >
                知道了
              </button>
            </div>
          ) : step === 'pay' || step === 'submitting' ? (
            <div className="space-y-4">
              {/* 订单摘要 */}
              <div className="rounded-lg border border-amber-100 bg-amber-50/60 px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-stone-600">充值金额</span>
                  <span className="text-sm font-semibold text-stone-800">¥{(finalPrice / 100).toFixed(2)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-sm text-stone-600">获得点数</span>
                  <span className="text-sm font-semibold text-amber-600">{finalPoints} 点</span>
                </div>
              </div>

              {/* 收款信息 */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-stone-500">收款信息</p>
                <div className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-3 text-sm">
                  <div className="flex justify-between py-0.5">
                    <span className="text-stone-500">银行</span>
                    <span className="font-medium text-stone-700">{BANK_INFO.bank}</span>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span className="text-stone-500">户名</span>
                    <span className="font-medium text-stone-700">{BANK_INFO.name}</span>
                  </div>
                  {BANK_INFO.cardNo && (
                    <div className="flex justify-between py-0.5">
                      <span className="text-stone-500">卡号</span>
                      <span className="font-medium text-stone-700 font-mono">{BANK_INFO.cardNo}</span>
                    </div>
                  )}
                </div>
                <p className="text-xs text-amber-600">{BANK_INFO.tip}</p>
              </div>

              {/* 上传凭证 */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-stone-500">上传转账凭证</p>
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 transition ${
                    dragOver ? 'border-amber-400 bg-amber-50' : 'border-stone-300 bg-stone-50'
                  }`}
                >
                  {proofPreview ? (
                    <img src={proofPreview} alt="凭证预览" className="max-h-32 rounded-md object-contain" />
                  ) : (
                    <>
                      <Upload className="h-6 w-6 text-stone-400" />
                      <p className="mt-2 text-xs text-stone-500">拖拽或点击上传转账截图</p>
                      <p className="text-[10px] text-stone-400">jpg/png，≤5MB</p>
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/jpeg,image/png"
                    onChange={handleFileInput}
                    className="absolute inset-0 cursor-pointer opacity-0"
                  />
                </div>
                {proofPreview && (
                  <button
                    onClick={() => { setProofFile(null); setProofPreview(null) }}
                    className="text-xs text-red-500 hover:text-red-600"
                  >
                    重新上传
                  </button>
                )}
              </div>

              {error && <p className="text-xs text-red-500">{error}</p>}

              <button
                onClick={handleSubmit}
                disabled={!proofFile || step === 'submitting'}
                className="w-full rounded-lg bg-stone-900 py-2.5 text-sm font-medium text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {step === 'submitting' ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    提交中...
                  </span>
                ) : (
                  '提交审核'
                )}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* 当前点数 */}
              <div className="flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 px-4 py-3">
                <div className="flex items-center gap-2">
                  <Diamond className="h-4 w-4 text-amber-500" />
                  <span className="text-sm text-stone-600">当前剩余点数</span>
                </div>
                <span className="text-sm font-semibold text-stone-800">{currentPoints}</span>
              </div>
              <p className="text-xs text-stone-400">1 元 = 100 点</p>

              {/* 快速档位 */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-stone-500">选择档位</p>
                <div className="grid grid-cols-3 gap-3">
                  {PRESET_PACKAGES.map((pkg, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSelectPkg(idx)}
                      className={`rounded-lg border-2 px-3 py-3 text-center transition ${
                        selectedPkg === idx
                          ? 'border-amber-400 bg-amber-50'
                          : 'border-stone-200 bg-white hover:border-stone-300'
                      }`}
                    >
                      <p className="text-xs font-medium text-stone-600">{pkg.label}</p>
                      <p className="mt-1 text-base font-bold text-stone-800">{pkg.points}</p>
                      <p className="text-[10px] text-stone-400">¥{(pkg.price / 100).toFixed(0)}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* 自定义金额 */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-stone-500">自定义金额</p>
                <div className="relative">
                  <input
                    type="number"
                    min={0.01}
                    step={0.01}
                    value={customAmount}
                    onChange={(e) => handleCustomChange(e.target.value)}
                    disabled={selectedPkg !== null}
                    placeholder="输入金额，自动计算点数"
                    className="w-full rounded-lg border border-stone-200 px-3 py-2 text-sm text-stone-800 placeholder:text-stone-300 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100 disabled:bg-stone-100 disabled:cursor-not-allowed"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-stone-400">元</span>
                </div>
                {customPrice !== null && customPrice > 0 && (
                  <p className="text-xs text-amber-600">可获得 {customPrice} 点</p>
                )}
              </div>

              <button
                onClick={handleConfirm}
                disabled={finalPrice <= 0}
                className="w-full rounded-lg bg-stone-900 py-2.5 text-sm font-medium text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                确认充值
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
