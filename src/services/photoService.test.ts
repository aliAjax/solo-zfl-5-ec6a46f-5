import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import {
  savePhotosForScene,
  getScenePhotos,
  deletePhotos,
  deletePhotosByScene,
  validatePhotoFile,
  sniffImageFormat,
  photoLimits,
  PhotoError,
} from './photoService'
import { dbGetTotalPhotoBytes, _resetPhotoDbForTests } from './photoDb'
import { makeImageFile, makeInvalidImageFile } from '@/test/helpers'
import { readBlobAsArrayBuffer } from '@/utils/blobUtils'

const DEFAULT_LIMITS = { ...photoLimits }

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  _resetPhotoDbForTests()
  Object.assign(photoLimits, DEFAULT_LIMITS)
})

afterEach(() => {
  Object.assign(photoLimits, DEFAULT_LIMITS)
})

describe('sniffImageFormat（文件头嗅探）', () => {
  it('识别常见图片格式', () => {
    expect(sniffImageFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg')
    expect(sniffImageFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('png')
    expect(sniffImageFormat(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBe('gif')
    expect(
      sniffImageFormat(
        new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
      ),
    ).toBe('webp')
    expect(sniffImageFormat(new Uint8Array([0x42, 0x4d]))).toBe('bmp')
  })

  it('无法识别时返回 null', () => {
    expect(sniffImageFormat(new Uint8Array([0x00, 0x01, 0x02]))).toBeNull()
    expect(sniffImageFormat(new Uint8Array([]))).toBeNull()
  })
})

describe('validatePhotoFile（选图即时校验）', () => {
  it('合法图片通过', async () => {
    await expect(validatePhotoFile(makeImageFile('a.png'))).resolves.toBeUndefined()
    await expect(validatePhotoFile(makeImageFile('b.jpg', 'jpeg'))).resolves.toBeUndefined()
  })

  it('超大文件明确失败', async () => {
    photoLimits.maxFileBytes = 16
    const err = await validatePhotoFile(makeImageFile('big.png', 'png', 64)).catch((e) => e)
    expect(err).toBeInstanceOf(PhotoError)
    expect(err.code).toBe('too-large')
    expect(err.message).toContain('big.png')
  })

  it('内容不是图片明确失败', async () => {
    const err = await validatePhotoFile(makeInvalidImageFile()).catch((e) => e)
    expect(err).toBeInstanceOf(PhotoError)
    expect(err.code).toBe('invalid-image')
  })

  it('非图片类型明确失败', async () => {
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'notes.txt', {
      type: 'text/plain',
    })
    const err = await validatePhotoFile(file).catch((e) => e)
    expect(err.code).toBe('invalid-image')
  })
})

describe('savePhotosForScene / getScenePhotos（保存与读取）', () => {
  it('保存后可按相同顺序读回，内容与类型一致', async () => {
    const files = [
      makeImageFile('1.png', 'png', 10),
      makeImageFile('2.jpg', 'jpeg', 20),
      makeImageFile('3.gif', 'gif', 30),
    ]
    const ids = await savePhotosForScene('scene-1', files)
    expect(ids).toHaveLength(3)

    const photos = await getScenePhotos(ids)
    expect(photos.map((p) => p.id)).toEqual(ids)
    expect(photos.map((p) => p.type)).toEqual(['image/png', 'image/jpeg', 'image/gif'])
    expect(photos.map((p) => p.size)).toEqual(files.map((f) => f.size))

    const first = new Uint8Array(await readBlobAsArrayBuffer(photos[0].blob))
    expect(first[0]).toBe(0x89) // PNG 头完整保留
  })

  it('空列表直接返回空数组', async () => {
    expect(await savePhotosForScene('scene-1', [])).toEqual([])
  })

  it('读取时跳过缺失的 id 且保持传入顺序', async () => {
    const ids = await savePhotosForScene('scene-1', [
      makeImageFile('1.png'),
      makeImageFile('2.png'),
    ])
    const photos = await getScenePhotos([ids[1], 'missing-id', ids[0]])
    expect(photos.map((p) => p.id)).toEqual([ids[1], ids[0]])
  })

  it('包含无效图片时整体失败，不写入任何照片', async () => {
    await expect(
      savePhotosForScene('scene-1', [makeImageFile('ok.png'), makeInvalidImageFile()]),
    ).rejects.toMatchObject({ code: 'invalid-image' })
    expect(await dbGetTotalPhotoBytes()).toBe(0)
  })

  it('包含超大文件时整体失败，不写入任何照片', async () => {
    photoLimits.maxFileBytes = 16
    await expect(
      savePhotosForScene('scene-1', [makeImageFile('ok.png', 'png', 4), makeImageFile('big.png', 'png', 64)]),
    ).rejects.toMatchObject({ code: 'too-large' })
    expect(await dbGetTotalPhotoBytes()).toBe(0)
  })

  it('超过单条数量上限明确失败', async () => {
    photoLimits.maxPhotosPerScene = 2
    await expect(
      savePhotosForScene('scene-1', [
        makeImageFile('1.png'),
        makeImageFile('2.png'),
        makeImageFile('3.png'),
      ]),
    ).rejects.toMatchObject({ code: 'too-many' })
    expect(await dbGetTotalPhotoBytes()).toBe(0)
  })
})

describe('容量控制（空间不足明确失败）', () => {
  it('超出容量上限时抛出 quota 错误，且不影响已存照片', async () => {
    photoLimits.quotaBytes = 100
    const small = makeImageFile('1.png', 'png', 40) // 48 字节
    const first = await savePhotosForScene('scene-1', [small])
    const used = await dbGetTotalPhotoBytes()
    expect(used).toBe(small.size)

    const another = makeImageFile('2.png', 'png', 60) // 48 + 68 > 100
    await expect(savePhotosForScene('scene-2', [another])).rejects.toMatchObject({
      code: 'quota',
    })

    // 已存照片完好，失败的照片没有留下痕迹
    expect(await dbGetTotalPhotoBytes()).toBe(used)
    expect(await getScenePhotos(first)).toHaveLength(1)
  })

  it('容量恰好够用时可以保存', async () => {
    const file = makeImageFile('1.png', 'png', 40)
    photoLimits.quotaBytes = file.size
    const ids = await savePhotosForScene('scene-1', [file])
    expect(await getScenePhotos(ids)).toHaveLength(1)
  })
})

describe('deletePhotos / deletePhotosByScene（删除与级联）', () => {
  it('deletePhotos 只删除指定照片', async () => {
    const ids = await savePhotosForScene('scene-1', [
      makeImageFile('1.png'),
      makeImageFile('2.png'),
      makeImageFile('3.png'),
    ])
    await deletePhotos([ids[1]])
    const remaining = await getScenePhotos(ids)
    expect(remaining.map((p) => p.id)).toEqual([ids[0], ids[2]])
  })

  it('deletePhotosByScene 清空该记录全部照片，不影响其他记录', async () => {
    const a = await savePhotosForScene('scene-a', [makeImageFile('1.png')])
    const b = await savePhotosForScene('scene-b', [makeImageFile('2.png')])
    await deletePhotosByScene('scene-a')
    expect(await getScenePhotos(a)).toEqual([])
    expect(await getScenePhotos(b)).toHaveLength(1)
  })

  it('删除不存在的 id 不报错', async () => {
    await expect(deletePhotos(['nope'])).resolves.toBeUndefined()
    await expect(deletePhotosByScene('nope')).resolves.toBeUndefined()
  })
})
