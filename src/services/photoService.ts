/**
 * 照片附件服务层：文件校验（大小 / 文件头 / 可解码性）、容量控制与读写编排。
 *
 * 所有失败都抛出带 code 的 PhotoError，UI 据此给出明确提示；
 * 任何失败都不会写入部分数据（照片先校验、再单事务写入）。
 */
import {
  dbPutPhotos,
  dbGetPhotos,
  dbDeletePhotos,
  dbDeletePhotosByScene,
  dbGetTotalPhotoBytes,
  type PhotoRecord,
} from './photoDb'
import { readBlobAsArrayBuffer } from '@/utils/blobUtils'

export type PhotoErrorCode =
  | 'too-large' // 单张超过大小限制
  | 'invalid-image' // 不是可识别的图片
  | 'undecodable' // 文件头正常但内容损坏，无法解码
  | 'too-many' // 超过单条记录的照片数量上限
  | 'quota' // 存储空间不足
  | 'write-failed' // 其他写入失败

export class PhotoError extends Error {
  readonly code: PhotoErrorCode
  readonly fileName?: string

  constructor(code: PhotoErrorCode, message: string, fileName?: string) {
    super(message)
    this.name = 'PhotoError'
    this.code = code
    this.fileName = fileName
  }
}

/** 可调限制；测试中可整体替换默认值 */
export const photoLimits = {
  /** 单张照片最大字节数 */
  maxFileBytes: 5 * 1024 * 1024,
  /** 单条记录最多照片数 */
  maxPhotosPerScene: 9,
  /** 全部照片的应用级容量上限（超出即明确失败） */
  quotaBytes: 40 * 1024 * 1024,
}

export interface PhotoBlob {
  id: string
  blob: Blob
  type: string
  size: number
}

type ImageFormat = 'jpeg' | 'png' | 'gif' | 'webp' | 'bmp'

/** 通过文件头魔数识别常见图片格式，识别不了返回 null */
export function sniffImageFormat(bytes: Uint8Array): ImageFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg'
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 && // P
    bytes[2] === 0x4e && // N
    bytes[3] === 0x47 // G
  ) {
    return 'png'
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x47 && // G
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x38 // 8
  ) {
    return 'gif'
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  ) {
    return 'webp'
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return 'bmp'
  }
  return null
}

function formatMb(bytes: number): string {
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10}MB`
}

/** 图片解码探测：返回 true 表示浏览器能真正解码该图片 */
export type ImageDecoder = (blob: Blob) => Promise<boolean>

/** 浏览器环境的真实解码探测：优先 createImageBitmap，兜底 <img> 加载 */
async function decodeImageInBrowser(blob: Blob): Promise<boolean> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob)
      const ok = bitmap.width > 0 && bitmap.height > 0
      bitmap.close()
      return ok
    } catch {
      return false
    }
  }
  if (typeof Image === 'undefined' || typeof URL.createObjectURL !== 'function') {
    // 无解码探测能力的环境（如未注入解码器的测试环境）：不阻断
    return true
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const probe = new Image()
    probe.onload = () => {
      URL.revokeObjectURL(url)
      resolve(probe.naturalWidth > 0)
    }
    probe.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(false)
    }
    probe.src = url
  })
}

let imageDecoder: ImageDecoder = decodeImageInBrowser

/** 仅供测试：注入模拟解码器；传 null 恢复浏览器默认实现 */
export function _setImageDecoderForTests(decoder: ImageDecoder | null): void {
  imageDecoder = decoder ?? decodeImageInBrowser
}

/** 解码探测，失败抛出 undecodable 错误 */
async function assertDecodable(blob: Blob, fileName: string): Promise<void> {
  let ok = false
  try {
    ok = await imageDecoder(blob)
  } catch {
    ok = false
  }
  if (!ok) {
    throw new PhotoError('undecodable', `「${fileName}」图片内容损坏，无法读取`, fileName)
  }
}

/** 校验单个文件的大小、MIME 与文件头，失败抛 PhotoError */
export function validatePhotoBuffer(
  file: { name: string; type: string; size: number },
  head: Uint8Array,
): void {
  if (file.size > photoLimits.maxFileBytes) {
    throw new PhotoError(
      'too-large',
      `「${file.name}」超过 ${formatMb(photoLimits.maxFileBytes)} 大小限制`,
      file.name,
    )
  }
  if (!file.type.startsWith('image/') || !sniffImageFormat(head)) {
    throw new PhotoError('invalid-image', `「${file.name}」不是有效的图片文件`, file.name)
  }
}

/** 校验单个文件（大小、文件头、可解码性），供表单选图时即时反馈 */
export async function validatePhotoFile(file: File): Promise<void> {
  const head = new Uint8Array(await readBlobAsArrayBuffer(file.slice(0, 16)))
  validatePhotoBuffer(file, head)
  await assertDecodable(file, file.name)
}

/**
 * 逐个校验一批文件，返回可进入待保存列表的文件与逐条错误信息。
 * 好图坏图混合时：好图全部保留，坏图各自给出明确原因，互不影响。
 * 超过 maxCount 的部分不校验，直接给出一条数量限制提示。
 */
export async function filterValidPhotoFiles(
  files: File[],
  maxCount: number,
): Promise<{ valid: File[]; errors: string[] }> {
  const valid: File[] = []
  const errors: string[] = []
  for (const file of files) {
    if (valid.length >= maxCount) {
      errors.push(`每条记录最多添加 ${photoLimits.maxPhotosPerScene} 张照片`)
      break
    }
    try {
      await validatePhotoFile(file)
      valid.push(file)
    } catch (err) {
      errors.push(err instanceof PhotoError ? err.message : `「${file.name}」添加失败`)
    }
  }
  return { valid, errors }
}

function isQuotaError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name?: string }).name === 'QuotaExceededError'
  )
}

/**
 * 校验并把照片写入某条记录，返回与传入顺序一致的照片 id 列表。
 * 失败（无效图片 / 超限 / 空间不足 / 写入异常）时不写入任何数据。
 */
export async function savePhotosForScene(sceneId: string, files: File[]): Promise<string[]> {
  if (files.length === 0) return []
  if (files.length > photoLimits.maxPhotosPerScene) {
    throw new PhotoError('too-many', `每条记录最多添加 ${photoLimits.maxPhotosPerScene} 张照片`)
  }

  const prepared: { file: File; buffer: ArrayBuffer }[] = []
  for (const file of files) {
    const buffer = await readBlobAsArrayBuffer(file)
    validatePhotoBuffer(file, new Uint8Array(buffer.slice(0, 16)))
    await assertDecodable(file, file.name)
    prepared.push({ file, buffer })
  }

  const incoming = prepared.reduce((sum, p) => sum + p.buffer.byteLength, 0)
  let used = 0
  try {
    used = await dbGetTotalPhotoBytes()
  } catch {
    // 容量统计失败不阻断保存，交给写入阶段兜底
  }
  if (used + incoming > photoLimits.quotaBytes) {
    throw new PhotoError('quota', '存储空间不足，照片保存失败，请清理后再试')
  }

  const createdAt = new Date().toISOString()
  const records: PhotoRecord[] = prepared.map(({ file, buffer }) => ({
    id: crypto.randomUUID(),
    sceneId,
    type: file.type,
    size: buffer.byteLength,
    createdAt,
    buffer,
  }))

  try {
    await dbPutPhotos(records)
  } catch (err) {
    if (isQuotaError(err)) {
      throw new PhotoError('quota', '存储空间不足，照片保存失败，请清理后再试')
    }
    throw new PhotoError('write-failed', '照片保存失败，请重试')
  }
  return records.map((r) => r.id)
}

/** 按 id 顺序读取照片内容（用于时间线详情展示） */
export async function getScenePhotos(ids: string[]): Promise<PhotoBlob[]> {
  const records = await dbGetPhotos(ids)
  return records.map((r) => ({
    id: r.id,
    blob: new Blob([r.buffer], { type: r.type }),
    type: r.type,
    size: r.size,
  }))
}

/** 删除指定照片 */
export async function deletePhotos(ids: string[]): Promise<void> {
  await dbDeletePhotos(ids)
}

/** 删除某条记录的全部照片（级联清理） */
export async function deletePhotosByScene(sceneId: string): Promise<void> {
  await dbDeletePhotosByScene(sceneId)
}
