import { describe, it, expect, beforeEach } from 'vitest'
import {
  getAllScenes,
  saveScene,
  updateScene,
  deleteScene,
  getScenesByRoute,
  getAllRouteNames,
} from './storage'
import type { WindowScene } from '@/types'

const STORAGE_KEY = 'bus_window_scenes'

function makeScene(overrides: Partial<WindowScene> = {}): WindowScene {
  return {
    id: crypto.randomUUID(),
    routeName: '1路',
    segment: 'A站-B站',
    seatDirection: '左',
    timestamp: '2026-09-15T08:00:00.000Z',
    weather: '晴',
    signText: '',
    treeDensity: '适中',
    pedestrianStatus: '稀少',
    note: '',
    photoIds: [],
    ...overrides,
  }
}

/** 旧版本记录：没有 photoIds 字段 */
const LEGACY_SCENE = {
  id: 'legacy-1',
  routeName: '2路',
  segment: '旧站-老站',
  seatDirection: '右',
  timestamp: '2025-01-01T10:00:00.000Z',
  weather: '多云',
  signText: '老招牌',
  treeDensity: '茂密',
  pedestrianStatus: '零星',
  note: '旧记录',
}

beforeEach(() => {
  localStorage.clear()
})

describe('storage（旧数据兼容）', () => {
  it('没有 photoIds 字段的旧记录读取后归一化为空数组', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([LEGACY_SCENE]))
    const scenes = getAllScenes()
    expect(scenes).toHaveLength(1)
    expect(scenes[0].id).toBe('legacy-1')
    expect(scenes[0].photoIds).toEqual([])
    expect(scenes[0].note).toBe('旧记录')
  })

  it('新旧记录混合读取互不影响', () => {
    const fresh = makeScene({ photoIds: ['p1', 'p2'] })
    localStorage.setItem(STORAGE_KEY, JSON.stringify([LEGACY_SCENE, fresh]))
    const scenes = getAllScenes()
    expect(scenes[0].photoIds).toEqual([])
    expect(scenes[1].photoIds).toEqual(['p1', 'p2'])
  })

  it('损坏的 JSON 返回空数组而不是抛错', () => {
    localStorage.setItem(STORAGE_KEY, '{broken')
    expect(getAllScenes()).toEqual([])
  })

  it('空存储返回空数组', () => {
    expect(getAllScenes()).toEqual([])
  })
})

describe('storage（增删改查）', () => {
  it('saveScene 追加记录并可读回', () => {
    const scene = makeScene({ photoIds: ['a', 'b'] })
    saveScene(scene)
    const scenes = getAllScenes()
    expect(scenes).toHaveLength(1)
    expect(scenes[0]).toEqual(scene)
  })

  it('updateScene 按 id 更新（用于单张照片移除后的 photoIds）', () => {
    const scene = makeScene({ photoIds: ['a', 'b', 'c'] })
    saveScene(scene)
    updateScene({ ...scene, photoIds: ['a', 'c'] })
    expect(getAllScenes()[0].photoIds).toEqual(['a', 'c'])
  })

  it('deleteScene 删除指定记录，不影响其他记录', () => {
    const a = makeScene()
    const b = makeScene({ routeName: '2路' })
    saveScene(a)
    saveScene(b)
    deleteScene(a.id)
    const scenes = getAllScenes()
    expect(scenes).toHaveLength(1)
    expect(scenes[0].id).toBe(b.id)
  })

  it('getScenesByRoute 按时间倒序', () => {
    const older = makeScene({ timestamp: '2026-01-01T08:00:00.000Z' })
    const newer = makeScene({ timestamp: '2026-06-01T08:00:00.000Z' })
    saveScene(older)
    saveScene(newer)
    const list = getScenesByRoute('1路')
    expect(list.map((s) => s.id)).toEqual([newer.id, older.id])
  })

  it('getAllRouteNames 去重并排序', () => {
    saveScene(makeScene({ routeName: '10路' }))
    saveScene(makeScene({ routeName: '2路' }))
    saveScene(makeScene({ routeName: '2路' }))
    expect(getAllRouteNames()).toEqual(['10路', '2路'].sort())
  })
})
