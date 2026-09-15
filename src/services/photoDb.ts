/**
 * 照片附件的 IndexedDB 原始存储层。
 *
 * 照片内容以 ArrayBuffer 存储（而非 Blob），保证在真实浏览器与
 * 测试环境（fake-indexeddb）中都能被 structuredClone 正确序列化。
 */

const DB_NAME = 'bus_window_scene_photos'
const DB_VERSION = 1
const STORE_NAME = 'photos'
const SCENE_INDEX = 'byScene'

export interface PhotoRecord {
  id: string
  sceneId: string
  /** 图片 MIME 类型，如 image/jpeg */
  type: string
  /** 字节数 */
  size: number
  createdAt: string
  buffer: ArrayBuffer
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
          store.createIndex(SCENE_INDEX, 'sceneId', { unique: false })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }
  return dbPromise
}

function runTx<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode)
        const store = tx.objectStore(STORE_NAME)
        let result: T | undefined
        const request = work(store)
        if (request) {
          request.onsuccess = () => {
            result = request.result
          }
        }
        tx.oncomplete = () => resolve(result)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error ?? new Error('事务被中止'))
      }),
  )
}

/** 批量写入照片记录（单事务，要么全部成功要么全部失败） */
export async function dbPutPhotos(records: PhotoRecord[]): Promise<void> {
  if (records.length === 0) return
  await runTx('readwrite', (store) => {
    for (const record of records) store.put(record)
  })
}

/** 按 id 列表读取照片，返回值严格按传入 id 的顺序排列，缺失的 id 被跳过 */
export async function dbGetPhotos(ids: string[]): Promise<PhotoRecord[]> {
  if (ids.length === 0) return []
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const found = new Map<string, PhotoRecord>()
    for (const id of ids) {
      const request = store.get(id)
      request.onsuccess = () => {
        const record = request.result as PhotoRecord | undefined
        if (record) found.set(id, record)
      }
    }
    tx.oncomplete = () => {
      resolve(ids.map((id) => found.get(id)).filter((r): r is PhotoRecord => Boolean(r)))
    }
    tx.onerror = () => reject(tx.error)
  })
}

/** 按 id 批量删除照片 */
export async function dbDeletePhotos(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await runTx('readwrite', (store) => {
    for (const id of ids) store.delete(id)
  })
}

/** 删除某条窗景记录下的全部照片（级联清理用） */
export async function dbDeletePhotosByScene(sceneId: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const index = tx.objectStore(STORE_NAME).index(SCENE_INDEX)
    const request = index.getAllKeys(IDBKeyRange.only(sceneId))
    request.onsuccess = () => {
      const store = tx.objectStore(STORE_NAME)
      for (const key of request.result) store.delete(key)
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('事务被中止'))
  })
}

/** 统计已存照片的总字节数（容量预检用） */
export async function dbGetTotalPhotoBytes(): Promise<number> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const request = tx.objectStore(STORE_NAME).openCursor()
    let total = 0
    request.onsuccess = () => {
      const cursor = request.result
      if (cursor) {
        total += (cursor.value as PhotoRecord).size
        cursor.continue()
      } else {
        resolve(total)
      }
    }
    request.onerror = () => reject(request.error)
  })
}

/** 仅供测试：重置缓存的数据库连接，配合全新的 indexedDB 实例使用 */
export function _resetPhotoDbForTests(): void {
  dbPromise = null
}
