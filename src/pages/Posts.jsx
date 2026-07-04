import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from 'firebase/firestore'
import {
  CalendarClock,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock,
  ExternalLink,
  Film,
  Hash,
  Image as ImageIcon,
  Link2,
  Loader,
  MapPin,
  MessageSquare,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Send,
  Trash2,
  TriangleAlert,
  UploadCloud,
  Users,
  X,
} from 'lucide-react'
import { db } from '../lib/firebase'
import { callFunction } from '../lib/api'
import { uploadMedia } from '../lib/upload'
import { useAccount } from '../context/AccountContext'
import { EmptyState, Modal, PageHeader, StatCard } from '../components/ui'
import DateTimePicker from '../components/DateTimePicker'

const CAPTION_MAX = 2200

const STATUS = {
  pending: { label: 'в очереди', tone: 't-orange', icon: Clock },
  processing: { label: 'публикуется', tone: 't-blue', icon: Loader },
  published: { label: 'опубликован', tone: 't-green', icon: CircleCheck },
  failed: { label: 'ошибка', tone: 't-red', icon: CircleX },
}

const emptyForm = {
  mediaType: 'image',
  mediaUrl: '',
  caption: '',
  firstComment: '',
  collaborators: '',
  locationId: '',
  altText: '',
  coverUrl: '',
  shareToFeed: true,
  scheduledLocal: defaultWhen(),
}

export default function Posts() {
  const { account, currentId, loading: accLoading } = useAccount()

  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [modal, setModal] = useState(null) // { mode:'create'|'edit', post? }
  const [busyId, setBusyId] = useState(null)
  const [notice, setNotice] = useState(null)

  // Живая подписка на очередь постов текущего бренда (scoping по currentId).
  useEffect(() => {
    if (!currentId) {
      setPosts([])
      setLoading(false)
      return
    }
    setLoading(true)
    const q = query(
      collection(db, 'accounts', currentId, 'scheduled_posts'),
      orderBy('scheduledAt', 'desc')
    )
    return onSnapshot(
      q,
      (snap) => {
        setPosts(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
        setLoading(false)
      },
      (err) => {
        setNotice({ type: 'error', text: `Ошибка загрузки: ${err.code ?? err.message}` })
        setLoading(false)
      }
    )
  }, [currentId])

  const stats = useMemo(() => {
    const by = (s) => posts.filter((p) => p.status === s).length
    const now = Date.now()
    const today = posts.filter((p) => {
      const t = p.scheduledAt?.toMillis?.()
      return p.status === 'pending' && t && t >= startOfToday() && t <= endOfToday()
    }).length
    return {
      pending: by('pending') + by('processing'),
      published: by('published'),
      failed: by('failed'),
      total: posts.length,
      today,
      now,
    }
  }, [posts])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return posts.filter((p) => {
      if (statusFilter !== 'all') {
        if (statusFilter === 'pending' && !['pending', 'processing'].includes(p.status)) return false
        if (statusFilter !== 'pending' && p.status !== statusFilter) return false
      }
      if (term && !(p.caption || '').toLowerCase().includes(term)) return false
      return true
    })
  }, [posts, search, statusFilter])

  const connected = account?.connectionStatus === 'connected'

  async function savePost(form) {
    const isVideo = form.mediaType === 'video'
    const payload = {
      caption: form.caption.trim(),
      mediaType: form.mediaType,
      mediaUrl: form.mediaUrl.trim(),
      firstComment: form.firstComment.trim(),
      collaborators: parseCollaborators(form.collaborators),
      locationId: form.locationId.trim(),
      altText: form.altText.trim(),
      coverUrl: isVideo ? form.coverUrl.trim() : '',
      shareToFeed: isVideo ? !!form.shareToFeed : true,
      scheduledAt: Timestamp.fromDate(new Date(form.scheduledLocal)),
      updatedAt: serverTimestamp(),
    }
    if (modal.mode === 'edit') {
      // Правка возвращает пост в очередь и сбрасывает прошлую ошибку/контейнер.
      await updateDoc(doc(db, 'accounts', currentId, 'scheduled_posts', modal.post.id), {
        ...payload,
        status: 'pending',
        error: deleteField(),
        containerId: deleteField(),
        leaseUntil: deleteField(),
      })
      setNotice({ type: 'success', text: 'Пост обновлён и возвращён в очередь.' })
    } else {
      await addDoc(collection(db, 'accounts', currentId, 'scheduled_posts'), {
        ...payload,
        status: 'pending',
        createdAt: serverTimestamp(),
      })
      setNotice({ type: 'success', text: 'Пост добавлен в очередь.' })
    }
    setModal(null)
  }

  async function publishNow(post) {
    setBusyId(post.id)
    setNotice(null)
    try {
      const res = await callFunction('publish-now', { accountId: currentId, postId: post.id })
      const msg =
        res.status === 'published'
          ? 'Пост опубликован в Instagram.'
          : res.status === 'processing'
            ? 'Медиа обрабатывается Instagram — публикация завершится автоматически.'
            : 'Не удалось опубликовать (см. статус поста).'
      setNotice({ type: res.status === 'failed' ? 'error' : 'success', text: msg })
    } catch (err) {
      setNotice({ type: 'error', text: err.message })
    } finally {
      setBusyId(null)
    }
  }

  async function retryPost(post) {
    await updateDoc(doc(db, 'accounts', currentId, 'scheduled_posts', post.id), {
      status: 'pending',
      error: deleteField(),
      containerId: deleteField(),
      leaseUntil: deleteField(),
      updatedAt: serverTimestamp(),
    })
    setNotice({ type: 'success', text: 'Пост возвращён в очередь.' })
  }

  async function removePost(post) {
    if (!window.confirm('Удалить пост из очереди?')) return
    await deleteDoc(doc(db, 'accounts', currentId, 'scheduled_posts', post.id))
    setNotice({ type: 'success', text: 'Пост удалён.' })
  }

  if (accLoading || loading)
    return (
      <div className="screen-center" style={{ minHeight: '50vh' }}>
        <div className="spinner" />
      </div>
    )

  if (!account)
    return (
      <div className="card">
        <EmptyState
          icon={CalendarClock}
          title="Сначала создайте бренд"
          text="Автопостинг работает в контексте бренд-аккаунта."
        />
      </div>
    )

  return (
    <>
      <PageHeader
        title="Автопостинг"
        sub="Планируйте публикации — Instagram получит их автоматически, с учётом лимитов Meta"
        actions={
          <button className="btn btn-primary" onClick={() => setModal({ mode: 'create' })}>
            <Plus size={16} />
            Запланировать пост
          </button>
        }
      />

      {!connected && (
        <div className="alert alert-warn" style={{ marginBottom: 16 }}>
          <TriangleAlert size={16} />
          <span>
            Instagram не подключён к бренду «{account.brandName}». Планировать посты можно, но
            публикация начнётся после подключения на странице{' '}
            <Link to="/accounts" style={{ fontWeight: 600 }}>
              Аккаунты
            </Link>
            .
          </span>
        </div>
      )}

      {notice && (
        <div className={`alert ${noticeClass(notice.type)}`} style={{ marginBottom: 16 }}>
          {notice.type === 'success' ? <CircleCheck size={16} /> : <TriangleAlert size={16} />}
          <span>{notice.text}</span>
          <button className="btn-icon" style={{ marginLeft: 'auto' }} onClick={() => setNotice(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      <div className="grid-stats">
        <StatCard icon={Clock} tone="orange" value={stats.pending} label="В очереди" sub={`${stats.today} на сегодня`} />
        <StatCard icon={CircleCheck} tone="green" value={stats.published} label="Опубликовано" />
        <StatCard icon={CircleX} tone="red" value={stats.failed} label="Ошибки" />
        <StatCard icon={CalendarClock} tone="gray" value={stats.total} label="Всего постов" />
      </div>

      <div className="toolbar">
        <div className="search-box">
          <Search size={15} />
          <input
            placeholder="Поиск по тексту поста…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">Все статусы</option>
          <option value="pending">В очереди</option>
          <option value="published">Опубликованные</option>
          <option value="failed">С ошибкой</option>
        </select>
        <span className="toolbar-count">
          {filtered.length}
          {filtered.length !== posts.length ? ` из ${posts.length}` : ''} постов
        </span>
      </div>

      <div className="card table-card">
        {posts.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="Очередь пуста"
            text="Запланируйте первую публикацию: текст, ссылка на медиа и время выхода. Опубликует автоматически serverless-функция по расписанию."
          />
        ) : filtered.length === 0 ? (
          <EmptyState small icon={Search} title="Ничего не найдено" text="Измените поиск или фильтр." />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: '40%' }}>Публикация</th>
                <th>Тип</th>
                <th>Время выхода</th>
                <th>Статус</th>
                <th style={{ textAlign: 'right' }}>Действия</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <PostRow
                  key={p.id}
                  post={p}
                  connected={connected}
                  busy={busyId === p.id}
                  onEdit={() => setModal({ mode: 'edit', post: p })}
                  onPublish={() => publishNow(p)}
                  onRetry={() => retryPost(p)}
                  onDelete={() => removePost(p)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <PostFormModal
          mode={modal.mode}
          post={modal.post}
          accountId={currentId}
          onClose={() => setModal(null)}
          onSave={savePost}
        />
      )}
    </>
  )
}

function PostRow({ post, connected, busy, onEdit, onPublish, onRetry, onDelete }) {
  const s = STATUS[post.status] || STATUS.pending
  const editable = ['pending', 'failed'].includes(post.status)
  const canPublish = connected && ['pending', 'failed'].includes(post.status)

  return (
    <tr>
      <td>
        <div className="post-cell">
          <Thumb post={post} />
          <div className="post-caption">
            <span className="post-text">{post.caption || <em className="muted">Без подписи</em>}</span>
            {post.status === 'failed' && post.error && (
              <span className="post-err">
                <CircleAlert size={12} /> {post.error}
              </span>
            )}
            {post.status === 'published' && post.permalink && (
              <a className="post-link" href={post.permalink} target="_blank" rel="noreferrer">
                Открыть в Instagram <ExternalLink size={11} />
              </a>
            )}
          </div>
        </div>
      </td>
      <td>
        <span className="badge t-gray">
          {post.mediaType === 'video' ? <Film size={12} /> : <ImageIcon size={12} />}
          {post.mediaType === 'video' ? 'Видео' : 'Фото'}
        </span>
      </td>
      <td className="mono nowrap">{formatWhen(post.scheduledAt)}</td>
      <td>
        <span className={`badge ${s.tone}`}>
          <s.icon size={12} />
          {s.label}
        </span>
      </td>
      <td>
        <div className="row-actions">
          {canPublish && (
            <button className="btn-icon" title="Опубликовать сейчас" onClick={onPublish} disabled={busy}>
              {busy ? <span className="spinner spinner-xs" /> : <Send size={15} />}
            </button>
          )}
          {post.status === 'failed' && (
            <button className="btn-icon" title="Вернуть в очередь" onClick={onRetry}>
              <RotateCcw size={15} />
            </button>
          )}
          {editable && (
            <button className="btn-icon" title="Редактировать" onClick={onEdit}>
              <Pencil size={15} />
            </button>
          )}
          <button className="btn-icon danger" title="Удалить" onClick={onDelete}>
            <Trash2 size={15} />
          </button>
        </div>
      </td>
    </tr>
  )
}

function Thumb({ post }) {
  const [ok, setOk] = useState(true)
  if (post.mediaType === 'image' && post.mediaUrl && ok) {
    return <img className="post-thumb" src={post.mediaUrl} alt="" onError={() => setOk(false)} />
  }
  return (
    <span className="post-thumb post-thumb-ph">
      {post.mediaType === 'video' ? <Film size={16} /> : <ImageIcon size={16} />}
    </span>
  )
}

function PostFormModal({ mode, post, accountId, onClose, onSave }) {
  const [form, setForm] = useState(
    mode === 'edit'
      ? {
          mediaType: post.mediaType || 'image',
          mediaUrl: post.mediaUrl || '',
          caption: post.caption || '',
          firstComment: post.firstComment || '',
          collaborators: (post.collaborators || []).join(', '),
          locationId: post.locationId || '',
          altText: post.altText || '',
          coverUrl: post.coverUrl || '',
          shareToFeed: post.shareToFeed !== false,
          scheduledLocal: toLocalInput(post.scheduledAt?.toDate?.() ?? new Date()),
        }
      : emptyForm
  )
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [showMore, setShowMore] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)

  const patch = (p) => setForm((f) => ({ ...f, ...p }))
  const set = (k) => (e) => patch({ [k]: e.target.value })
  const isVideo = form.mediaType === 'video'

  async function handleFile(file) {
    if (!file) return
    setError('')
    setUploading(true)
    setProgress(0)
    try {
      const { url, mediaType } = await uploadMedia(file, accountId, setProgress)
      patch({ mediaUrl: url, mediaType })
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  async function submit(e) {
    e.preventDefault()
    if (!form.mediaUrl.trim()) return setError('Загрузите фото/видео или вставьте ссылку на медиа.')
    if (!/^https?:\/\//i.test(form.mediaUrl.trim())) {
      return setError('Ссылка на медиа должна быть публичным URL (http/https).')
    }
    if (form.caption.length > CAPTION_MAX) return setError(`Подпись длиннее ${CAPTION_MAX} символов.`)
    if (parseCollaborators(form.collaborators).length > 3) {
      return setError('Instagram допускает не более 3 соавторов.')
    }
    if (!form.scheduledLocal) return setError('Укажите дату и время публикации.')
    if (new Date(form.scheduledLocal).getTime() < Date.now() - 60000) {
      return setError('Время публикации должно быть в будущем. Для немедленной отправки используйте «Опубликовать сейчас».')
    }
    setError('')
    setSaving(true)
    try {
      await onSave(form)
    } catch (err) {
      setError(err.code ?? err.message)
      setSaving(false)
    }
  }

  const captionLeft = CAPTION_MAX - form.caption.length

  return (
    <Modal
      title={mode === 'edit' ? 'Редактировать пост' : 'Новый пост'}
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} type="button">
            Отмена
          </button>
          <button className="btn btn-primary" form="post-form" disabled={saving || uploading}>
            {saving ? 'Сохраняем…' : mode === 'edit' ? 'Сохранить' : 'В очередь'}
          </button>
        </>
      }
    >
      <form id="post-form" onSubmit={submit}>
        <div className="field">
          <label className="field-label">Тип публикации</label>
          <div className="seg">
            <button
              type="button"
              className={`seg-btn${!isVideo ? ' active' : ''}`}
              onClick={() => patch({ mediaType: 'image' })}
            >
              <ImageIcon size={15} /> Фото
            </button>
            <button
              type="button"
              className={`seg-btn${isVideo ? ' active' : ''}`}
              onClick={() => patch({ mediaType: 'video' })}
            >
              <Film size={15} /> Видео (Reels)
            </button>
          </div>
        </div>

        <MediaField
          form={form}
          isVideo={isVideo}
          uploading={uploading}
          progress={progress}
          onFile={handleFile}
          onUrl={(v) => patch({ mediaUrl: v })}
          onClear={() => patch({ mediaUrl: '' })}
        />

        <div className="field">
          <div className="field-label-row">
            <label className="field-label" htmlFor="caption">
              Подпись
            </label>
            <span className={`char-count${captionLeft < 0 ? ' over' : ''}`}>
              {form.caption.length} / {CAPTION_MAX}
              <span className="char-hash">
                <Hash size={11} />
                {countHashtags(form.caption)}
              </span>
            </span>
          </div>
          <textarea
            id="caption"
            rows={4}
            value={form.caption}
            onChange={set('caption')}
            placeholder="Текст публикации, эмодзи, упоминания @…"
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="firstComment">
            <MessageSquare size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />
            Первый комментарий <span className="field-opt">необязательно</span>
          </label>
          <textarea
            id="firstComment"
            rows={2}
            value={form.firstComment}
            onChange={set('firstComment')}
            placeholder="Например, блок хэштегов — уйдёт отдельным комментарием сразу после публикации"
          />
        </div>

        <div className="field">
          <label className="field-label">Дата и время публикации</label>
          <DateTimePicker
            id="when"
            value={form.scheduledLocal}
            onChange={(v) => patch({ scheduledLocal: v })}
          />
        </div>

        <button type="button" className="more-toggle" onClick={() => setShowMore((v) => !v)}>
          <ChevronDown size={15} className={showMore ? 'rot' : ''} />
          Дополнительно: соавторы, локация, alt-текст{isVideo ? ', обложка' : ''}
        </button>

        {showMore && (
          <div className="more-fields">
            <div className="field">
              <label className="field-label" htmlFor="collab">
                <Users size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />
                Соавторы <span className="field-opt">до 3, через запятую</span>
              </label>
              <input
                id="collab"
                value={form.collaborators}
                onChange={set('collaborators')}
                placeholder="brand_partner, blogger"
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="alt">
                Alt-текст <span className="field-opt">доступность</span>
              </label>
              <input
                id="alt"
                value={form.altText}
                onChange={set('altText')}
                placeholder="Описание изображения для незрячих"
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="loc">
                <MapPin size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />
                Location ID <span className="field-opt">Facebook Pages ID места</span>
              </label>
              <input id="loc" value={form.locationId} onChange={set('locationId')} placeholder="напр. 111962635507851" />
            </div>

            {isVideo && (
              <>
                <div className="field">
                  <label className="field-label" htmlFor="cover">
                    Обложка Reels (URL) <span className="field-opt">необязательно</span>
                  </label>
                  <input id="cover" value={form.coverUrl} onChange={set('coverUrl')} placeholder="https://…/cover.jpg" />
                </div>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={form.shareToFeed}
                    onChange={(e) => patch({ shareToFeed: e.target.checked })}
                  />
                  Показывать Reels в основной ленте профиля
                </label>
              </>
            )}
          </div>
        )}

        {error && (
          <div className="alert alert-error" style={{ marginTop: 4 }}>
            <TriangleAlert size={15} />
            <span>{error}</span>
          </div>
        )}
      </form>
    </Modal>
  )
}

function MediaField({ form, isVideo, uploading, progress, onFile, onUrl, onClear }) {
  const [urlMode, setUrlMode] = useState(false)
  const accept = isVideo ? 'video/*' : 'image/*'

  if (uploading) {
    return (
      <div className="field">
        <label className="field-label">Медиа</label>
        <div className="upload-progress">
          <Loader size={16} className="spin" />
          <div className="upload-bar">
            <div className="upload-bar-fill" style={{ width: `${progress}%` }} />
          </div>
          <span className="mono">{progress}%</span>
        </div>
      </div>
    )
  }

  if (form.mediaUrl) {
    return (
      <div className="field">
        <label className="field-label">Медиа</label>
        <div className="media-preview">
          {form.mediaType === 'image' ? (
            <img src={form.mediaUrl} alt="" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
          ) : (
            <span className="media-preview-ph">
              <Film size={22} />
            </span>
          )}
          <div className="media-preview-info">
            <span className="media-preview-url">{form.mediaUrl}</span>
            <button type="button" className="linklike" onClick={onClear}>
              Убрать / заменить
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="field">
      <label className="field-label">Медиа</label>
      {urlMode ? (
        <>
          <input
            autoFocus
            value={form.mediaUrl}
            onChange={(e) => onUrl(e.target.value)}
            placeholder={isVideo ? 'https://…/reel.mp4' : 'https://…/photo.jpg'}
          />
          <p className="field-hint">
            Публичный URL медиа.{' '}
            <button type="button" className="linklike" onClick={() => setUrlMode(false)}>
              загрузить файл с устройства
            </button>
          </p>
        </>
      ) : (
        <>
          <label className="dropzone">
            <input
              type="file"
              accept={accept}
              hidden
              onChange={(e) => onFile(e.target.files?.[0])}
            />
            <UploadCloud size={26} />
            <span className="dropzone-title">Загрузить {isVideo ? 'видео' : 'фото'} с устройства</span>
            <span className="dropzone-hint">
              {isVideo ? 'MP4/MOV до 300 МБ' : 'JPG/PNG до 8 МБ'} · нажмите, чтобы выбрать
            </span>
          </label>
          <p className="field-hint">
            <Link2 size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />
            <button type="button" className="linklike" onClick={() => setUrlMode(true)}>
              или вставить ссылку на медиа
            </button>
          </p>
        </>
      )}
    </div>
  )
}

/* ---- helpers ---- */

function noticeClass(type) {
  return type === 'success' ? 'alert-success' : type === 'warn' ? 'alert-warn' : 'alert-error'
}

// "@a, b  c" -> ['a','b','c'] (макс 3, без @, без пустых)
function parseCollaborators(raw) {
  return String(raw || '')
    .split(/[\s,]+/)
    .map((s) => s.trim().replace(/^@/, ''))
    .filter(Boolean)
    .slice(0, 3)
}

function countHashtags(text) {
  return (String(text).match(/#[\p{L}\p{N}_]+/gu) || []).length
}

function pad(n) {
  return String(n).padStart(2, '0')
}

function toLocalInput(date) {
  const d = new Date(date)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function defaultWhen() {
  const d = new Date(Date.now() + 60 * 60 * 1000) // через час
  d.setMinutes(0, 0, 0)
  return toLocalInput(d)
}

function formatWhen(ts) {
  const d = ts?.toDate?.()
  if (!d) return '—'
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function endOfToday() {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}
