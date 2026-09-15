/** 生成带真实文件头的测试图片文件 */
const HEADERS: Record<string, number[]> = {
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  jpeg: [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46],
  gif: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
  webp: [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50],
  bmp: [0x42, 0x4d],
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
}

export type TestImageFormat = keyof typeof HEADERS

/** 构造一个带合法魔数的图片 File；extraBytes 控制文件总大小 */
export function makeImageFile(
  name: string,
  format: TestImageFormat = 'png',
  extraBytes = 32,
): File {
  const header = HEADERS[format]
  const body = new Uint8Array(header.length + extraBytes)
  body.set(header, 0)
  for (let i = header.length; i < body.length; i++) body[i] = i % 251
  return new File([body], name, { type: MIME[format] })
}

/** 构造一个内容不是图片的 File */
export function makeInvalidImageFile(name = 'fake.png'): File {
  return new File([new TextEncoder().encode('这不是图片内容')], name, {
    type: 'image/png',
  })
}
