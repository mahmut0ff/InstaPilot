import { useEffect, useMemo, useState } from 'react'
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore'
import {
  CircleCheck,
  Languages,
  MessagesSquare,
  Save,
  ShieldAlert,
  Smile,
  Sparkles,
  TriangleAlert,
  WandSparkles,
  X,
} from 'lucide-react'
import { db } from '../lib/firebase'
import { useAccount } from '../context/AccountContext'
import { EmptyState, PageHeader, Switch } from '../components/ui'

const DEFAULTS = {
  toneOfVoice: '',
  brandContext: '',
  forbiddenTopics: [],
  language: 'auto',
  useEmojis: true,
  signature: '',
  autoReplyComments: false,
  autoReplyDms: false,
  draftMode: true,
  escalateNegative: true,
}

const LANGUAGES = [
  { value: 'auto', label: 'Как у собеседника (авто)' },
  { value: 'ru', label: 'Русский' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'kk', label: 'Қазақша' },
]

const TONE_MAX = 1000
const CONTEXT_MAX = 2000

export default function Settings() {
  const { account, currentId, loading: accLoading } = useAccount()
  const [saved, setSaved] = useState(null) // как в Firestore
  const [form, setForm] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(null)
  const [topicInput, setTopicInput] = useState('')

  useEffect(() => {
    if (!currentId) return
    setLoading(true)
    const ref = doc(db, 'accounts', currentId, 'settings', 'bot')
    return onSnapshot(
      ref,
      (snap) => {
        const data = { ...DEFAULTS, ...(snap.data() || {}) }
        setSaved(data)
        setForm((prev) => prev ?? data) // не затираем несохранённые правки при живом обновлении
        setLoading(false)
      },
      (err) => {
        setNotice({ type: 'error', text: `Ошибка загрузки: ${err.code ?? err.message}` })
        setLoading(false)
      }
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId])

  const dirty = useMemo(() => saved && form && !shallowEqual(saved, form), [saved, form])

  const patch = (p) => setForm((f) => ({ ...f, ...p }))

  function addTopic() {
    const t = topicInput.trim().toLowerCase()
    if (!t) return
    if (!form.forbiddenTopics.includes(t)) patch({ forbiddenTopics: [...form.forbiddenTopics, t] })
    setTopicInput('')
  }

  function removeTopic(t) {
    patch({ forbiddenTopics: form.forbiddenTopics.filter((x) => x !== t) })
  }

  async function save() {
    setSaving(true)
    setNotice(null)
    try {
      await setDoc(
        doc(db, 'accounts', currentId, 'settings', 'bot'),
        { ...form, updatedAt: serverTimestamp() },
        { merge: true }
      )
      setNotice({ type: 'success', text: 'Настройки сохранены.' })
    } catch (err) {
      setNotice({ type: 'error', text: `Не удалось сохранить: ${err.code ?? err.message}` })
    } finally {
      setSaving(false)
    }
  }

  if (accLoading || loading || !form)
    return (
      <div className="screen-center" style={{ minHeight: '50vh' }}>
        <div className="spinner" />
      </div>
    )

  if (!account)
    return (
      <div className="card">
        <EmptyState icon={WandSparkles} title="Сначала создайте бренд" text="Настройки бота задаются для каждого бренда." />
      </div>
    )

  return (
    <>
      <PageHeader
        title="Настройки бота"
        sub="Как отвечает AI под именем вашего бренда. Эти правила уйдут в промпт Gemini на этапе 5."
        actions={
          <button className="btn btn-primary" onClick={save} disabled={!dirty || saving}>
            <Save size={16} />
            {saving ? 'Сохраняем…' : dirty ? 'Сохранить' : 'Сохранено'}
          </button>
        }
      />

      {notice && (
        <div className={`alert ${notice.type === 'success' ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: 16 }}>
          {notice.type === 'success' ? <CircleCheck size={16} /> : <TriangleAlert size={16} />}
          <span>{notice.text}</span>
          <button className="btn-icon" style={{ marginLeft: 'auto' }} onClick={() => setNotice(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      <div className="grid-settings">
        {/* ЛЕВО: голос бренда */}
        <div className="card">
          <div className="card-head">
            <WandSparkles size={16} />
            <h3>Голос бренда</h3>
          </div>

          <div className="field">
            <div className="field-label-row">
              <label className="field-label" htmlFor="tone">
                Тон общения
              </label>
              <span className={`char-count${form.toneOfVoice.length > TONE_MAX ? ' over' : ''}`}>
                {form.toneOfVoice.length} / {TONE_MAX}
              </span>
            </div>
            <textarea
              id="tone"
              rows={4}
              value={form.toneOfVoice}
              onChange={(e) => patch({ toneOfVoice: e.target.value })}
              placeholder="Например: дружелюбно и на «ты», с лёгким юмором, без канцелярита. Благодарим за каждый отзыв, на негатив отвечаем спокойно и предлагаем продолжить в директе."
            />
            <p className="field-hint">Чем конкретнее, тем точнее бот выдержит голос бренда.</p>
          </div>

          <div className="field">
            <div className="field-label-row">
              <label className="field-label" htmlFor="ctx">
                <Sparkles size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />
                Факты о бренде <span className="field-opt">для точных ответов</span>
              </label>
              <span className={`char-count${form.brandContext.length > CONTEXT_MAX ? ' over' : ''}`}>
                {form.brandContext.length} / {CONTEXT_MAX}
              </span>
            </div>
            <textarea
              id="ctx"
              rows={4}
              value={form.brandContext}
              onChange={(e) => patch({ brandContext: e.target.value })}
              placeholder="Часы работы, адрес, доставка, ссылки, частые вопросы и ответы. Бот будет опираться на это, а не выдумывать."
            />
          </div>

          <div className="field">
            <label className="field-label">
              <ShieldAlert size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />
              Запрещённые темы
            </label>
            <div className="tags">
              {form.forbiddenTopics.map((t) => (
                <span className="tag" key={t}>
                  {t}
                  <button type="button" className="tag-x" onClick={() => removeTopic(t)} aria-label={`Убрать ${t}`}>
                    <X size={12} />
                  </button>
                </span>
              ))}
              <input
                className="tag-input"
                value={topicInput}
                onChange={(e) => setTopicInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addTopic()
                  }
                }}
                onBlur={addTopic}
                placeholder="+ добавить и Enter"
              />
            </div>
            <p className="field-hint">
              Если комментарий касается этих тем, бот не отвечает и помечает его для ручной обработки.
            </p>
          </div>

          <div className="settings-2col">
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="field-label" htmlFor="lang">
                <Languages size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />
                Язык ответов
              </label>
              <select id="lang" className="input" value={form.language} onChange={(e) => patch({ language: e.target.value })}>
                {LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="field-label" htmlFor="sign">
                Подпись <span className="field-opt">в конце ответа</span>
              </label>
              <input
                id="sign"
                value={form.signature}
                onChange={(e) => patch({ signature: e.target.value })}
                placeholder="— команда бренда"
              />
            </div>
          </div>

          <div className="setting-row" style={{ marginTop: 8 }}>
            <div className="setting-body">
              <div className="setting-title">
                <Smile size={14} /> Использовать эмодзи
              </div>
              <p className="setting-desc">Бот сможет добавлять уместные эмодзи в ответы.</p>
            </div>
            <Switch checked={form.useEmojis} onChange={(e) => patch({ useEmojis: e.target.checked })} label="эмодзи" />
          </div>
        </div>

        {/* ПРАВО: режимы ответов */}
        <div className="card">
          <div className="card-head">
            <MessagesSquare size={16} />
            <h3>Режимы ответов</h3>
          </div>

          <div className="setting-row">
            <div className="setting-body">
              <div className="setting-title">Автоответы на комментарии</div>
              <p className="setting-desc">Бот отвечает на новые комментарии под постами (этап 5).</p>
            </div>
            <Switch
              checked={form.autoReplyComments}
              onChange={(e) => patch({ autoReplyComments: e.target.checked })}
              label="автоответы на комментарии"
            />
          </div>

          <div className="setting-row">
            <div className="setting-body">
              <div className="setting-title">
                Автоответы в директ
                <span className="chip chip-purple">после App Review</span>
              </div>
              <p className="setting-desc">
                Модуль директа готов. Чтобы заработал: пройдите Meta App Review, добавьте scope
                instagram_business_manage_messages и поле messages в вебхуки, затем включите тумблер.
              </p>
            </div>
            <Switch
              checked={form.autoReplyDms}
              onChange={(e) => patch({ autoReplyDms: e.target.checked })}
              label="автоответы в директ"
            />
          </div>

          <div className="setting-row">
            <div className="setting-body">
              <div className="setting-title">
                Режим «черновик»
                <span className="chip chip-green">рекомендуем</span>
              </div>
              <p className="setting-desc">
                Ответы бота не отправляются сразу, а ждут вашего одобрения в «Логе ответов».
              </p>
            </div>
            <Switch checked={form.draftMode} onChange={(e) => patch({ draftMode: e.target.checked })} label="режим черновик" />
          </div>

          <div className="setting-row">
            <div className="setting-body">
              <div className="setting-title">Эскалация негатива</div>
              <p className="setting-desc">
                Жалобы и явный негатив бот не комментирует, а помечает для ручного ответа.
              </p>
            </div>
            <Switch
              checked={form.escalateNegative}
              onChange={(e) => patch({ escalateNegative: e.target.checked })}
              label="эскалация негатива"
            />
          </div>

          <div className="info-box">
            <Sparkles size={15} />
            <div>
              <strong>Как это работает</strong>
              Тон, факты о бренде и правила выше собираются в системный промпт для Gemini. На этапе 5
              бот начнёт отвечать на комментарии; в режиме «черновик» — только после вашего одобрения.
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function shallowEqual(a, b) {
  const keys = Object.keys(DEFAULTS)
  return keys.every((k) => {
    if (Array.isArray(a[k]) || Array.isArray(b[k])) {
      return JSON.stringify(a[k] ?? []) === JSON.stringify(b[k] ?? [])
    }
    return a[k] === b[k]
  })
}
