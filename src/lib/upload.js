import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage'
import { auth, storage } from './firebase'

// Лимиты (ориентир на требования Instagram): фото ≤ 8 МБ, видео ≤ 300 МБ.
const MAX_IMAGE = 8 * 1024 * 1024
const MAX_VIDEO = 300 * 1024 * 1024

// Загружает файл в Firebase Storage и возвращает публичную download-ссылку,
// по которой Instagram Graph API заберёт медиа. onProgress(percent) — прогресс 0..100.
export function uploadMedia(file, accountId, onProgress) {
  return new Promise((resolve, reject) => {
    const uid = auth.currentUser?.uid
    if (!uid) return reject(new Error('Сессия истекла — войдите заново'))

    const isVideo = file.type.startsWith('video/')
    const isImage = file.type.startsWith('image/')
    if (!isVideo && !isImage) return reject(new Error('Поддерживаются только фото и видео'))
    if (isImage && file.size > MAX_IMAGE) return reject(new Error('Фото больше 8 МБ'))
    if (isVideo && file.size > MAX_VIDEO) return reject(new Error('Видео больше 300 МБ'))

    const safeName = file.name.replace(/[^\w.\-]+/g, '_')
    const path = `uploads/${uid}/${accountId}/${Date.now()}_${safeName}`
    const task = uploadBytesResumable(ref(storage, path), file, { contentType: file.type })

    task.on(
      'state_changed',
      (snap) => onProgress?.(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      (err) => reject(new Error(uploadErrorText(err))),
      async () => {
        try {
          const url = await getDownloadURL(task.snapshot.ref)
          resolve({ url, path, mediaType: isVideo ? 'video' : 'image' })
        } catch (err) {
          reject(new Error(uploadErrorText(err)))
        }
      }
    )
  })
}

function uploadErrorText(err) {
  const code = err?.code || ''
  if (code === 'storage/unauthorized')
    return 'Нет доступа к хранилищу. Включите Firebase Storage и опубликуйте storage.rules.'
  if (code === 'storage/retry-limit-exceeded') return 'Загрузка прервалась, попробуйте ещё раз'
  if (code === 'storage/canceled') return 'Загрузка отменена'
  return err?.message || 'Не удалось загрузить файл'
}
