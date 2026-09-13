export type BillingSource = 'USER' | 'GROUP'

export interface BillingPolicyInput {
  isAdmin: boolean
  userPoints: number
  cost: number
  group?: {
    id: string
    points: number
    costMode: 'MEMBER_PAY' | 'GROUP_POOL'
  } | null
}

export interface BillingPolicyDecision {
  source: BillingSource
  groupId: string | null
  currentPoints: number
  cost: number
}

/** 纯策略函数：决定一次项目操作应由个人还是小组点数池付款。 */
export function selectBillingTarget(input: BillingPolicyInput): BillingPolicyDecision {
  if (input.isAdmin) {
    return {
      source: 'USER',
      groupId: null,
      currentPoints: input.userPoints,
      cost: 0,
    }
  }

  if (input.group?.costMode === 'GROUP_POOL') {
    return {
      source: 'GROUP',
      groupId: input.group.id,
      currentPoints: input.group.points,
      cost: input.cost,
    }
  }

  return {
    source: 'USER',
    groupId: null,
    currentPoints: input.userPoints,
    cost: input.cost,
  }
}
