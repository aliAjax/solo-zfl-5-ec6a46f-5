import { useEffect, useState } from 'react'
import { X, Trash2 } from 'lucide-react'
import { getScenePhotos } from '@/services/photoService'

interface PhotoItem {
  id: string
  url: string
}

interface ScenePhotosProps {
  /** 有序的照片 id 列表，展示顺序与其一致 */
  photoIds: string[]
  onRemove: (photoId: string) => void
}

/** 时间线详情中的照片区：按序缩略图、点击放大、单张移除 */
export default function ScenePhotos({ photoIds, onRemove }: ScenePhotosProps) {
  const [items, setItems] = useState<PhotoItem[]>([])
  const [zoomedId, setZoomedId] = useState<string | null>(null)

  const key = photoIds.join(',')

  useEffect(() => {
    let cancelled = false
    let created: PhotoItem[] = []
    getScenePhotos(key ? key.split(',') : [])
      .then((photos) => {
        created = photos.map((p) => ({ id: p.id, url: URL.createObjectURL(p.blob) }))
        if (cancelled) {
          created.forEach((i) => URL.revokeObjectURL(i.url))
          created = []
          return
        }
        setItems(created)
      })
      .catch(() => {
        if (!cancelled) setItems([])
      })
    return () => {
      cancelled = true
      created.forEach((i) => URL.revokeObjectURL(i.url))
      created = []
      setItems([])
    }
  }, [key])

  if (items.length === 0) return null

  const zoomed = items.find((i) => i.id === zoomedId) ?? null

  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        {items.map((item) => (
          <div
            key={item.id}
            className="group relative aspect-square overflow-hidden rounded-lg border border-teal-800"
          >
            <button
              type="button"
              onClick={() => setZoomedId(item.id)}
              className="block h-full w-full"
              aria-label="放大照片"
            >
              <img src={item.url} alt="窗景照片" className="h-full w-full object-cover" />
            </button>
            <button
              type="button"
              aria-label="移除该照片"
              onClick={() => onRemove(item.id)}
              className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-mist-100 opacity-0 transition group-hover:opacity-100 hover:bg-red-900/80"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      {zoomed && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4"
          onClick={() => setZoomedId(null)}
        >
          <button
            type="button"
            aria-label="关闭大图"
            onClick={() => setZoomedId(null)}
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-mist-100 transition hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={zoomed.url}
            alt="窗景照片大图"
            className="max-h-full max-w-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
