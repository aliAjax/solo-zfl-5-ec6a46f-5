import { useState, useEffect, useRef } from 'react'
import { Bus, MapPin, Armchair, Clock, CloudSun, Signpost, TreePine, Users, FileText, Send, Image } from 'lucide-react'
import { useSceneStore } from '@/store/useSceneStore'
import { getWeatherIcon, getTreeIcon, getPedestrianIcon, formatTimestamp } from '@/utils/sceneHelpers'
import PhotoPicker, { type PendingPhoto } from '@/components/PhotoPicker'
import { validatePhotoFile, photoLimits, PhotoError } from '@/services/photoService'
import { moveItem } from '@/utils/arrayUtils'
import type { SceneFormData, Weather, TreeDensity, PedestrianStatus, SeatDirection } from '@/types'

const WEATHERS: Weather[] = ['晴', '多云', '阴', '小雨', '大雨', '雪', '雾']
const TREES: TreeDensity[] = ['稀疏', '适中', '茂密']
const PEDESTRIANS: PedestrianStatus[] = ['稀少', '零星', '密集']

const initialForm: SceneFormData = {
  routeName: '',
  segment: '',
  seatDirection: '左',
  weather: '晴',
  signText: '',
  treeDensity: '适中',
  pedestrianStatus: '稀少',
  note: '',
}

export default function RecordPage() {
  const saveScene = useSceneStore((s) => s.saveScene)
  const loadAll = useSceneStore((s) => s.loadAll)
  const [form, setForm] = useState<SceneFormData>(initialForm)
  const [now, setNow] = useState(new Date())
  const [showSuccess, setShowSuccess] = useState(false)
  const [photos, setPhotos] = useState<PendingPhoto[]>([])
  const [photoError, setPhotoError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const photosRef = useRef<PendingPhoto[]>([])
  photosRef.current = photos

  useEffect(() => { loadAll() }, [loadAll])

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(timer)
  }, [])

  // 卸载时释放所有预览 URL
  useEffect(() => {
    return () => {
      photosRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl))
    }
  }, [])

  const update = <K extends keyof SceneFormData>(key: K, val: SceneFormData[K]) =>
    setForm((prev) => ({ ...prev, [key]: val }))

  const handleAddPhotos = async (files: File[]) => {
    const added: PendingPhoto[] = []
    const errors: string[] = []
    for (const file of files) {
      if (photosRef.current.length + added.length >= photoLimits.maxPhotosPerScene) {
        errors.push(`每条记录最多添加 ${photoLimits.maxPhotosPerScene} 张照片`)
        break
      }
      try {
        await validatePhotoFile(file)
        added.push({
          localId: crypto.randomUUID(),
          file,
          previewUrl: URL.createObjectURL(file),
        })
      } catch (err) {
        errors.push(err instanceof PhotoError ? err.message : `「${file.name}」添加失败`)
      }
    }
    if (added.length > 0) setPhotos((prev) => [...prev, ...added])
    setPhotoError(errors.join('；'))
  }

  const handleMovePhoto = (localId: string, direction: -1 | 1) => {
    setPhotos((prev) => {
      const from = prev.findIndex((p) => p.localId === localId)
      return moveItem(prev, from, from + direction)
    })
  }

  const handleRemovePhoto = (localId: string) => {
    setPhotos((prev) => {
      const target = prev.find((p) => p.localId === localId)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((p) => p.localId !== localId)
    })
  }

  const clearPhotos = () => {
    photosRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl))
    setPhotos([])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setSaveError('')
    try {
      await saveScene(form, photos.map((p) => p.file))
      setShowSuccess(true)
      setTimeout(() => {
        setShowSuccess(false)
        setForm(initialForm)
        clearPhotos()
        setPhotoError('')
      }, 1500)
    } catch (err) {
      // 保存失败：表单与已选照片全部保留，仅提示原因
      setSaveError(err instanceof Error ? err.message : '保存失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative min-h-screen bg-teal-950 p-4 pb-24">
      {showSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="animate-bounce flex flex-col items-center gap-2 opacity-0" style={{ animation: 'fadeInUp 1.5s ease forwards' }}>
            <Bus className="w-16 h-16 text-dusk-400" />
            <span className="text-mist-100 font-serif text-lg">记录已保存</span>
          </div>
          <style>{`@keyframes fadeInUp { 0% { opacity:0; transform:translateY(20px) } 40% { opacity:1; transform:translateY(0) } 100% { opacity:0; transform:translateY(-40px) } }`}</style>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mx-auto max-w-lg space-y-6">
        <div className="flex items-center gap-2 mb-2">
          <Bus className="w-6 h-6 text-dusk-400" />
          <h1 className="text-mist-100 font-serif text-2xl">窗景记录</h1>
        </div>

        <section className="space-y-3">
          <h2 className="text-dusk-400 font-serif text-lg flex items-center gap-2">
            <MapPin className="w-4 h-4" />路线信息
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-mist-300 text-xs mb-1 flex items-center gap-1"><Bus className="w-3 h-3" />线路</label>
              <input className="w-full bg-teal-850 text-mist-100 rounded-xl px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-dusk-400" value={form.routeName} onChange={(e) => update('routeName', e.target.value)} required />
            </div>
            <div>
              <label className="text-mist-300 text-xs mb-1 flex items-center gap-1"><MapPin className="w-3 h-3" />区间</label>
              <input className="w-full bg-teal-850 text-mist-100 rounded-xl px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-dusk-400" value={form.segment} onChange={(e) => update('segment', e.target.value)} required />
            </div>
          </div>
          <div>
            <label className="text-mist-300 text-xs mb-1 flex items-center gap-1"><Armchair className="w-3 h-3" />座位方向</label>
            <div className="flex gap-2">
              {(['左', '右'] as SeatDirection[]).map((d) => (
                <button key={d} type="button" onClick={() => update('seatDirection', d)}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium transition ${form.seatDirection === d ? 'bg-dusk-400/20 text-dusk-400 border border-dusk-400' : 'bg-teal-850 text-mist-300 border border-transparent'}`}>
                  {d}侧
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-dusk-400 font-serif text-lg flex items-center gap-2">
            <CloudSun className="w-4 h-4" />窗景信息
          </h2>
          <div>
            <label className="text-mist-300 text-xs mb-1 block">天气</label>
            <div className="grid grid-cols-4 gap-2">
              {WEATHERS.map((w) => (
                <button key={w} type="button" onClick={() => update('weather', w)}
                  className={`flex flex-col items-center gap-1 py-2 rounded-xl text-xs transition ${form.weather === w ? 'bg-dusk-400/20 border border-dusk-400 text-dusk-400' : 'bg-teal-850 border border-transparent text-mist-300'}`}>
                  {getWeatherIcon(w)}{w}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-mist-300 text-xs mb-1 flex items-center gap-1"><Signpost className="w-3 h-3" />招牌文字</label>
            <input className="w-full bg-teal-850 text-mist-100 rounded-xl px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-dusk-400" value={form.signText} onChange={(e) => update('signText', e.target.value)} />
          </div>
          <div>
            <label className="text-mist-300 text-xs mb-1 flex items-center gap-1"><TreePine className="w-3 h-3" />树木密度</label>
            <div className="grid grid-cols-3 gap-2">
              {TREES.map((t) => (
                <button key={t} type="button" onClick={() => update('treeDensity', t)}
                  className={`flex flex-col items-center gap-1 py-3 rounded-xl text-xs transition ${form.treeDensity === t ? 'bg-dusk-400/20 border border-dusk-400 text-dusk-400' : 'bg-teal-850 border border-transparent text-mist-300'}`}>
                  {getTreeIcon(t)}{t}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-mist-300 text-xs mb-1 flex items-center gap-1"><Users className="w-3 h-3" />行人状态</label>
            <div className="grid grid-cols-3 gap-2">
              {PEDESTRIANS.map((p) => (
                <button key={p} type="button" onClick={() => update('pedestrianStatus', p)}
                  className={`flex flex-col items-center gap-1 py-3 rounded-xl text-xs transition ${form.pedestrianStatus === p ? 'bg-dusk-400/20 border border-dusk-400 text-dusk-400' : 'bg-teal-850 border border-transparent text-mist-300'}`}>
                  {getPedestrianIcon(p)}{p}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-dusk-400 font-serif text-lg flex items-center gap-2">
            <FileText className="w-4 h-4" />观察笔记
          </h2>
          <textarea className="w-full bg-teal-850 text-mist-100 rounded-xl px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-dusk-400 resize-none h-24" value={form.note} onChange={(e) => update('note', e.target.value)} />
        </section>

        <section className="space-y-3">
          <h2 className="text-dusk-400 font-serif text-lg flex items-center gap-2">
            <Image className="w-4 h-4" />窗景照片
            <span className="text-mist-500 text-xs font-normal">
              {photos.length}/{photoLimits.maxPhotosPerScene}
            </span>
          </h2>
          <PhotoPicker
            photos={photos}
            maxPhotos={photoLimits.maxPhotosPerScene}
            disabled={submitting}
            onAdd={handleAddPhotos}
            onMove={handleMovePhoto}
            onRemove={handleRemovePhoto}
          />
          {photoError && <p className="text-red-300 text-xs">{photoError}</p>}
        </section>

        <div className="flex items-center gap-2 text-mist-400 text-xs">
          <Clock className="w-3 h-3" />
          <span>{formatTimestamp(now.toISOString())}</span>
        </div>

        {saveError && <p className="text-red-300 text-xs">{saveError}</p>}

        <button type="submit" disabled={submitting}
          className="w-full py-3 rounded-xl bg-dusk-400 text-teal-950 font-medium text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition disabled:opacity-60">
          <Send className="w-4 h-4" />{submitting ? '保存中…' : '保存记录'}
        </button>
      </form>
    </div>
  )
}
