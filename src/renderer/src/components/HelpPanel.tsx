import { useMemo, useRef, useState } from 'react'
import { BookOpen, ChevronLeft, ChevronRight, Keyboard, Lightbulb, ListChecks, MousePointerClick, PlayCircle, Search, Target, Wrench } from 'lucide-react'
import { GROUPS, SHORTCUTS, TOPICS, type HelpTopic } from '../lib/help'

/** Every searchable string of a topic. */
const textOf = (t: HelpTopic): string =>
  [
    t.title,
    t.summary,
    ...(t.when ?? []),
    ...t.steps,
    ...(t.buttons ?? []).flat(),
    ...(t.example ? [t.example.title, ...t.example.steps] : []),
    ...(t.faq ?? []).flat(),
    ...(t.tips ?? [])
  ].join(' ')

/** The "Hướng dẫn" tab: grouped table of contents, search, detailed topics, "show me" tours. */
export function HelpPanel({ onTour }: { onTour: (t: HelpTopic) => void }) {
  const [sel, setSel] = useState(() => localStorage.getItem('helpTopic') ?? TOPICS[0].id)
  const [q, setQ] = useState('')
  const body = useRef<HTMLDivElement>(null)

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? TOPICS.filter((t) => textOf(t).toLowerCase().includes(s)) : TOPICS
  }, [q])
  const topic = list.find((t) => t.id === sel) ?? list[0]
  const idx = topic ? TOPICS.indexOf(topic) : -1
  const pick = (id: string): void => {
    setSel(id)
    localStorage.setItem('helpTopic', id)
    body.current?.scrollTo({ top: 0 })
  }

  // Highlight the searched words.
  const mark = (text: string): React.ReactNode => {
    const s = q.trim()
    if (!s) return text
    const i = text.toLowerCase().indexOf(s.toLowerCase())
    if (i < 0) return text
    return (
      <>
        {text.slice(0, i)}
        <mark>{text.slice(i, i + s.length)}</mark>
        {mark(text.slice(i + s.length))}
      </>
    )
  }

  return (
    <div className="panel wide help-panel">
      <div className="help-toc">
        <div className="help-search">
          <Search size={12} />
          <input className="input" placeholder="Tìm: crash, quyền, Jira, chữ to…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {GROUPS.map((g) => {
          const items = list.filter((t) => t.group === g)
          if (!items.length) return null
          return (
            <div key={g} className="help-group">
              <div className="help-group-h">{g}</div>
              {items.map((t) => (
                <button key={t.id} className={`help-item ${topic?.id === t.id ? 'on' : ''}`} onClick={() => pick(t.id)}>
                  <b>{mark(t.title)}</b>
                  <span>{t.summary}</span>
                </button>
              ))}
            </div>
          )
        })}
        {list.length === 0 && <div className="steps-empty">Không thấy mục nào có “{q}”.</div>}
        <div className="help-keys">
          <div className="help-keys-h">
            <Keyboard size={12} /> Phím tắt
          </div>
          {SHORTCUTS.map(([k, v]) => (
            <div key={k} className="help-key">
              <kbd>{k}</kbd> <span>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {topic && (
        <div className="help-body" ref={body}>
          <div className="help-crumb muted">{topic.group}</div>
          <div className="help-title">
            <BookOpen size={16} />
            <h2>{topic.title}</h2>
            <span className="spacer" />
            {topic.tour && (
              <button className="iconbtn primary" onClick={() => onTour(topic)} title="Làm mờ màn hình và chỉ vào từng nút liên quan">
                <PlayCircle size={13} /> Chỉ cho tôi ({topic.tour.length} bước)
              </button>
            )}
          </div>
          <p className="muted">{topic.summary}</p>

          {topic.when && topic.when.length > 0 && (
            <div className="help-when">
              <Target size={13} />
              <div>
                <b>Dùng khi nào</b>
                <ul>
                  {topic.when.map((s, i) => (
                    <li key={i}>{mark(s)}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <h3>
            <ListChecks size={14} /> Cách dùng
          </h3>
          <ol className="help-steps">
            {topic.steps.map((s, i) => (
              <li key={i}>{mark(s)}</li>
            ))}
          </ol>

          {topic.buttons && topic.buttons.length > 0 && (
            <>
              <h3>
                <MousePointerClick size={14} /> Giải thích từng nút
              </h3>
              <table className="help-table">
                <tbody>
                  {topic.buttons.map(([k, v], i) => (
                    <tr key={i}>
                      <th>{mark(k)}</th>
                      <td>{mark(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {topic.example && (
            <div className="help-example">
              <b>Ví dụ: {mark(topic.example.title)}</b>
              <ol>
                {topic.example.steps.map((s, i) => (
                  <li key={i}>{mark(s)}</li>
                ))}
              </ol>
            </div>
          )}

          {topic.faq && topic.faq.length > 0 && (
            <>
              <h3>
                <Wrench size={14} /> Lỗi thường gặp &amp; cách xử lý
              </h3>
              <div className="help-faq">
                {topic.faq.map(([qq, a], i) => (
                  <details key={i} open={!!q.trim()}>
                    <summary>{mark(qq)}</summary>
                    <div>{mark(a)}</div>
                  </details>
                ))}
              </div>
            </>
          )}

          {topic.tips && topic.tips.length > 0 && (
            <>
              <h3>
                <Lightbulb size={14} /> Mẹo
              </h3>
              <ul className="help-tips">
                {topic.tips.map((s, i) => (
                  <li key={i}>{mark(s)}</li>
                ))}
              </ul>
            </>
          )}

          <div className="help-pager">
            {idx > 0 ? (
              <button className="iconbtn ghost" onClick={() => pick(TOPICS[idx - 1].id)}>
                <ChevronLeft size={13} /> {TOPICS[idx - 1].title}
              </button>
            ) : (
              <span />
            )}
            {idx >= 0 && idx < TOPICS.length - 1 && (
              <button className="iconbtn ghost" onClick={() => pick(TOPICS[idx + 1].id)}>
                {TOPICS[idx + 1].title} <ChevronRight size={13} />
              </button>
            )}
          </div>
          <p className="muted help-more">Chi tiết kỹ thuật hơn: file README.md đi kèm ADB Kit.</p>
        </div>
      )}
    </div>
  )
}
