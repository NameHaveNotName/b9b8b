import assert from 'node:assert/strict'
import test from 'node:test'
import { selectBillingTarget } from '../lib/billing-policy.ts'

test('个人项目由执行用户付款', () => {
  assert.deepEqual(
    selectBillingTarget({ isAdmin: false, userPoints: 20, cost: 3 }),
    { source: 'USER', groupId: null, currentPoints: 20, cost: 3 },
  )
})

test('成员自付小组仍由执行用户付款', () => {
  assert.deepEqual(
    selectBillingTarget({
      isAdmin: false,
      userPoints: 20,
      cost: 3,
      group: { id: 'group-1', points: 100, costMode: 'MEMBER_PAY' },
    }),
    { source: 'USER', groupId: null, currentPoints: 20, cost: 3 },
  )
})

test('小组池模式由小组公共余额付款', () => {
  assert.deepEqual(
    selectBillingTarget({
      isAdmin: false,
      userPoints: 0,
      cost: 3,
      group: { id: 'group-1', points: 100, costMode: 'GROUP_POOL' },
    }),
    { source: 'GROUP', groupId: 'group-1', currentPoints: 100, cost: 3 },
  )
})

test('管理员延续免扣规则且不消耗小组池', () => {
  assert.deepEqual(
    selectBillingTarget({
      isAdmin: true,
      userPoints: 0,
      cost: 3,
      group: { id: 'group-1', points: 100, costMode: 'GROUP_POOL' },
    }),
    { source: 'USER', groupId: null, currentPoints: 0, cost: 0 },
  )
})
