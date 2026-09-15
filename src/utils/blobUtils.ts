/** 读取 Blob 内容为 ArrayBuffer；老环境（无 Blob.arrayBuffer）走 FileReader 兜底 */
export function readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer()
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'))
    reader.readAsArrayBuffer(blob)
  })
}
