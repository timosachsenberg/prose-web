/** Saves `data` as a file through the browser's download (nothing leaves the computer). */
export function download(name: string, data: BlobPart, type = 'text/plain'): void {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
