import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { useSceneStore, SceneStorageError } from './useSceneStore'
import { getAllScenes } from '@/services/storage'
import {
  getScenePhotos,
  photoLimits,
  PhotoError,
  _setImageDecoderForTests,
} from '@/services/photoService'
import { dbGetTotalPhotoBytes, _resetPhotoDbForTests } from '@/services/photoDb'
import {
  makeImageFile,
  makeInvalidImageFile,
  makeUndecodableImageFile,
  fakeImageDecoder,
} from '@/test/helpers'
import type { SceneFormData } from '@/types'

const STORAGE_KEY = 'bus_window_scenes'

const FORM: SceneFormData = {
  routeName: '1路',
  segment: '起点-终点',
  seatDirection: '左',
  weather: '晴',
  signText: '便利店',
  treeDensity: '适中',
  pedestrianStatus: '稀少',
  note: '测试笔记',
}

const INITIAL_STATE = {
  scenes: [],
  routeNames: [],
  currentRouteScenes: [],
  selectedRoute: '',
  randomScene: null,
}

const DEFAULT_LIMITS = { ...photoLimits }

function resetStore() {
  useSceneStore.setState(INITIAL_STATE)
}

beforeEach(() => {
  localStorage.clear()
  globalThis.indexedDB = new IDBFactory()
  _resetPhotoDbForTests()
  Object.assign(photoLimits, DEFAULT_LIMITS)
  resetStore()
})

afterEach(() => {
  vi.restoreAllMocks()
  _setImageDecoderForTests(null)
})

describe('saveScene（新增记录）', () => {
  it('不带照片保存与旧行为一致，photoIds 为空数组', async () => {
    await useSceneStore.getState().saveScene(FORM)
    const scenes = getAllScenes()
    expect(scenes).toHaveLength(1)
    expect(scenes[0].photoIds).toEqual([])
    expect(useSceneStore.getState().scenes).toHaveLength(1)
  })

  it('带多张照片保存，photoIds 按传入顺序持久化', async () => {
    const files = [
      makeImageFile('1.png', 'png', 10),
      makeImageFile('2.jpg', 'jpeg', 20),
      makeImageFile('3.gif', 'gif', 30),
    ]
    await useSceneStore.getState().saveScene(FORM, files)

    const scene = getAllScenes()[0]
    expect(scene.photoIds).toHaveLength(3)
    // 顺序即文件顺序（排序后的结果会被忠实保存）
    const photos = await getScenePhotos(scene.photoIds)
    expect(photos.map((p) => p.size)).toEqual(files.map((f) => f.size))
  })

  it('刷新（重置内存状态后 loadAll）仍能取回记录与照片', async () => {
    const files = [makeImageFile('1.png'), makeImageFile('2.png')]
    await useSceneStore.getState().saveScene(FORM, files)
    const savedIds = getAllScenes()[0].photoIds

    resetStore() // 模拟页面刷新：内存状态清空，localStorage 与 IndexedDB 仍在
    expect(useSceneStore.getState().scenes).toEqual([])

    useSceneStore.getState().loadAll()
    const scenes = useSceneStore.getState().scenes
    expect(scenes).toHaveLength(1)
    expect(scenes[0].photoIds).toEqual(savedIds)
    expect(await getScenePhotos(scenes[0].photoIds)).toHaveLength(2)
  })
})

describe('saveScene（失败路径：不影响已有数据）', () => {
  it('无效图片：保存明确失败，记录与照片都不落盘', async () => {
    await expect(
      useSceneStore.getState().saveScene(FORM, [makeInvalidImageFile()]),
    ).rejects.toBeInstanceOf(PhotoError)
    expect(getAllScenes()).toEqual([])
    expect(await dbGetTotalPhotoBytes()).toBe(0)
    expect(useSceneStore.getState().scenes).toEqual([])
  })

  it('超大文件：保存明确失败，已有记录不受影响', async () => {
    await useSceneStore.getState().saveScene(FORM) // 先存一条正常记录
    photoLimits.maxFileBytes = 16
    await expect(
      useSceneStore.getState().saveScene(FORM, [makeImageFile('big.png', 'png', 64)]),
    ).rejects.toMatchObject({ code: 'too-large' })
    expect(getAllScenes()).toHaveLength(1)
    expect(await dbGetTotalPhotoBytes()).toBe(0)
  })

  it('内容损坏的图片（文件头正常但无法解码）：保存明确失败，已有记录不受影响', async () => {
    _setImageDecoderForTests(fakeImageDecoder)
    await useSceneStore.getState().saveScene(FORM) // 先存一条正常记录
    await expect(
      useSceneStore.getState().saveScene(FORM, [makeUndecodableImageFile()]),
    ).rejects.toMatchObject({ code: 'undecodable' })
    expect(getAllScenes()).toHaveLength(1)
    expect(await dbGetTotalPhotoBytes()).toBe(0)
    expect(useSceneStore.getState().scenes).toHaveLength(1)
  })

  it('好图坏图混合提交：整体保存失败，记录与照片都不落盘', async () => {
    _setImageDecoderForTests(fakeImageDecoder)
    await expect(
      useSceneStore
        .getState()
        .saveScene(FORM, [makeImageFile('good.png'), makeUndecodableImageFile()]),
    ).rejects.toMatchObject({ code: 'undecodable' })
    expect(getAllScenes()).toEqual([])
    expect(await dbGetTotalPhotoBytes()).toBe(0)
    expect(useSceneStore.getState().scenes).toEqual([])
  })

  it('空间不足：保存明确失败，已有记录与照片完好', async () => {
    await useSceneStore.getState().saveScene(FORM, [makeImageFile('ok.png', 'png', 40)])
    const before = await dbGetTotalPhotoBytes()
    expect(before).toBeGreaterThan(0)

    photoLimits.quotaBytes = before + 10
    await expect(
      useSceneStore.getState().saveScene(FORM, [makeImageFile('more.png', 'png', 40)]),
    ).rejects.toMatchObject({ code: 'quota' })

    expect(getAllScenes()).toHaveLength(1)
    expect(await dbGetTotalPhotoBytes()).toBe(before)
  })

  it('元数据写入失败：已存照片被回滚，不产生孤儿附件', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    await expect(
      useSceneStore.getState().saveScene(FORM, [makeImageFile('1.png')]),
    ).rejects.toBeInstanceOf(SceneStorageError)
    expect(getAllScenes()).toEqual([])
    expect(await dbGetTotalPhotoBytes()).toBe(0)
  })
})

describe('removePhotoFromScene（单张移除）', () => {
  it('移除中间一张后顺序保持、文件同步删除', async () => {
    const files = [
      makeImageFile('1.png', 'png', 10),
      makeImageFile('2.png', 'png', 20),
      makeImageFile('3.png', 'png', 30),
    ]
    await useSceneStore.getState().saveScene(FORM, files)
    const scene = getAllScenes()[0]
    const [id1, id2, id3] = scene.photoIds

    await useSceneStore.getState().removePhotoFromScene(scene.id, id2)

    expect(getAllScenes()[0].photoIds).toEqual([id1, id3])
    const remaining = await getScenePhotos([id1, id2, id3])
    expect(remaining.map((p) => p.id)).toEqual([id1, id3])
    // store 中的状态同步刷新
    expect(useSceneStore.getState().scenes[0].photoIds).toEqual([id1, id3])
  })

  it('对没有照片的旧记录调用不产生副作用', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ ...FORM, id: 'legacy', timestamp: '2025-01-01T00:00:00.000Z' }]),
    )
    useSceneStore.getState().loadAll()
    await useSceneStore.getState().removePhotoFromScene('legacy', 'missing')
    expect(getAllScenes()[0].photoIds).toEqual([])
  })
})

describe('deleteScene（级联清理）', () => {
  it('删除记录时其照片一并消失，其他记录的照片不受影响', async () => {
    await useSceneStore.getState().saveScene(FORM, [makeImageFile('1.png')])
    await useSceneStore
      .getState()
      .saveScene({ ...FORM, routeName: '2路' }, [makeImageFile('2.png')])
    const [first, second] = getAllScenes()

    await useSceneStore.getState().deleteScene(first.id)

    expect(getAllScenes().map((s) => s.id)).toEqual([second.id])
    expect(await getScenePhotos(first.photoIds)).toEqual([])
    expect(await getScenePhotos(second.photoIds)).toHaveLength(1)
  })

  it('删除没有照片的旧记录正常完成', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ ...FORM, id: 'legacy', timestamp: '2025-01-01T00:00:00.000Z' }]),
    )
    useSceneStore.getState().loadAll()
    await useSceneStore.getState().deleteScene('legacy')
    expect(getAllScenes()).toEqual([])
    expect(useSceneStore.getState().scenes).toEqual([])
  })
})

describe('旧数据兼容', () => {
  it('没有 photoIds 的旧记录 loadAll 后正常显示', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { ...FORM, id: 'old-1', timestamp: '2025-01-01T00:00:00.000Z' },
        { ...FORM, id: 'old-2', timestamp: '2025-02-01T00:00:00.000Z', note: '旧笔记' },
      ]),
    )
    useSceneStore.getState().loadAll()
    const scenes = useSceneStore.getState().scenes
    expect(scenes).toHaveLength(2)
    expect(scenes[0].photoIds).toEqual([])
    expect(scenes[1].photoIds).toEqual([])
    expect(scenes[1].note).toBe('旧笔记')
  })
})
