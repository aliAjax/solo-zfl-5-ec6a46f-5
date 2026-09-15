import { create } from 'zustand'
import type { WindowScene, SceneFormData } from '@/types'
import {
  getAllScenes,
  saveScene as storageSaveScene,
  updateScene as storageUpdateScene,
  deleteScene as storageDeleteScene,
  getScenesByRoute,
  getAllRouteNames,
  getRandomScene,
} from '@/services/storage'
import {
  savePhotosForScene,
  deletePhotos,
  deletePhotosByScene,
} from '@/services/photoService'

/** 元数据写入失败（如 localStorage 空间不足） */
export class SceneStorageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SceneStorageError'
  }
}

interface SceneState {
  scenes: WindowScene[]
  routeNames: string[]
  currentRouteScenes: WindowScene[]
  selectedRoute: string
  randomScene: WindowScene | null

  loadAll: () => void
  saveScene: (data: SceneFormData, photos?: File[]) => Promise<void>
  deleteScene: (id: string) => Promise<void>
  removePhotoFromScene: (sceneId: string, photoId: string) => Promise<void>
  selectRoute: (routeName: string) => void
  refreshRandom: () => void
}

function refreshedState(selectedRoute: string) {
  return {
    scenes: getAllScenes(),
    routeNames: getAllRouteNames(),
    currentRouteScenes: selectedRoute ? getScenesByRoute(selectedRoute) : [],
  }
}

export const useSceneStore = create<SceneState>((set) => ({
  scenes: [],
  routeNames: [],
  currentRouteScenes: [],
  selectedRoute: '',
  randomScene: null,

  loadAll: () => {
    const scenes = getAllScenes()
    const routeNames = getAllRouteNames()
    set({ scenes, routeNames })
  },

  saveScene: async (data: SceneFormData, photos: File[] = []) => {
    const id = crypto.randomUUID()
    // 先写照片（校验 / 配额失败在此抛出，元数据不落盘）
    const photoIds = await savePhotosForScene(id, photos)
    const scene: WindowScene = {
      ...data,
      id,
      photoIds,
      timestamp: new Date().toISOString(),
    }
    try {
      storageSaveScene(scene)
    } catch (err) {
      // 元数据写入失败：回滚已存照片，保证不产生孤儿附件
      await deletePhotos(photoIds).catch(() => {})
      const quota =
        typeof err === 'object' &&
        err !== null &&
        'name' in err &&
        (err as { name?: string }).name === 'QuotaExceededError'
      throw new SceneStorageError(
        quota ? '存储空间不足，记录保存失败，请清理后再试' : '记录保存失败，请重试',
      )
    }
    set((state) => refreshedState(state.selectedRoute))
  },

  deleteScene: async (id: string) => {
    // 先删元数据，再级联清理照片；照片清理失败不影响记录已删除的事实
    storageDeleteScene(id)
    await deletePhotosByScene(id).catch(() => {})
    set((state) => refreshedState(state.selectedRoute))
  },

  removePhotoFromScene: async (sceneId: string, photoId: string) => {
    const scene = getAllScenes().find((s) => s.id === sceneId)
    if (!scene) return
    const photoIds = scene.photoIds.filter((pid) => pid !== photoId)
    storageUpdateScene({ ...scene, photoIds })
    await deletePhotos([photoId]).catch(() => {})
    set((state) => refreshedState(state.selectedRoute))
  },

  selectRoute: (routeName: string) => {
    const currentRouteScenes = routeName ? getScenesByRoute(routeName) : []
    set({ selectedRoute: routeName, currentRouteScenes })
  },

  refreshRandom: () => {
    const randomScene = getRandomScene()
    set({ randomScene })
  },
}))
