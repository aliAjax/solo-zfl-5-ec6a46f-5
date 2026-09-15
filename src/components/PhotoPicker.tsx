import { useRef } from 'react'
import { ImagePlus, X, ChevronLeft, ChevronRight } from 'lucide-react'

export interface PendingPhoto {
  localId: string
  file: File
  previewUrl: string
}

interface PhotoPickerProps {
  photos: PendingPhoto[]
  maxPhotos: number
  disabled?: boolean
  onAdd: (files: File[]) => void
  onMove: (localId: string, direction: -1 | 1) => void
  onRemove: (localId: string) => void
}

/** 记录页的照片选择器：多选、预览、左右排序、单张移除 */
export default function PhotoPicker({
  photos,
  maxPhotos,
  disabled = false,
  onAdd,
  onMove,
  onRemove,
}: PhotoPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    // 重置 input，允许再次选择同一文件
    e.target.value = ''
    if (files.length > 0) onAdd(files)
  }

  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        {photos.map((photo, index) => (
          <div
            key={photo.localId}
            className="relative aspect-square overflow-hidden rounded-xl border border-teal-800 bg-teal-900"
          >
            <img
              src={photo.previewUrl}
              alt={photo.file.name}
              className="h-full w-full object-cover"
            />
            <button
              type="button"
              aria-label={`移除照片 ${photo.file.name}`}
              onClick={() => onRemove(photo.localId)}
              disabled={disabled}
              className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-mist-100 transition hover:bg-black/80"
            >
              <X className="h-3 w-3" />
            </button>
            <div className="absolute bottom-1 left-1 right-1 flex justify-between">
              <button
                type="button"
                aria-label="前移"
                onClick={() => onMove(photo.localId, -1)}
                disabled={disabled || index === 0}
                className="rounded-full bg-black/60 p-1 text-mist-100 transition hover:bg-black/80 disabled:opacity-30"
              >
                <ChevronLeft className="h-3 w-3" />
              </button>
              <button
                type="button"
                aria-label="后移"
                onClick={() => onMove(photo.localId, 1)}
                disabled={disabled || index === photos.length - 1}
                className="rounded-full bg-black/60 p-1 text-mist-100 transition hover:bg-black/80 disabled:opacity-30"
              >
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        ))}

        {photos.length < maxPhotos && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={disabled}
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-teal-700 text-mist-400 transition hover:border-dusk-400/50 hover:text-dusk-300"
          >
            <ImagePlus className="h-5 w-5" />
            <span className="text-[10px]">添加照片</span>
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleChange}
      />
    </div>
  )
}
