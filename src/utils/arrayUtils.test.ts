import { describe, it, expect } from 'vitest'
import { moveItem } from './arrayUtils'

describe('moveItem（照片排序）', () => {
  it('向后移动元素', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
  })

  it('向前移动元素', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
  })

  it('从末尾移到末尾、相邻交换', () => {
    expect(moveItem(['a', 'b', 'c'], 1, 2)).toEqual(['a', 'c', 'b'])
  })

  it('相同位置不变', () => {
    expect(moveItem(['a', 'b'], 1, 1)).toEqual(['a', 'b'])
  })

  it('越界索引返回等值副本', () => {
    expect(moveItem(['a', 'b'], -1, 0)).toEqual(['a', 'b'])
    expect(moveItem(['a', 'b'], 0, 5)).toEqual(['a', 'b'])
    expect(moveItem(['a', 'b'], 5, 0)).toEqual(['a', 'b'])
  })

  it('不修改原数组', () => {
    const list = ['a', 'b', 'c']
    moveItem(list, 0, 2)
    expect(list).toEqual(['a', 'b', 'c'])
  })
})
