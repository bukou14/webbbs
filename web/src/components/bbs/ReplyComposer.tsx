import { useState } from 'react';
import type { ComposerState, ReplyDestination, ReplyDraft, ReplyQuote } from './types';

export interface ReplyComposerProps {
  composer: ComposerState;
  onSubmit: (draft: ReplyDraft) => void;
  onClose: () => void;
}

const CATEGORIES: [string, string][] = [
  ['a', '問題'],
  ['b', '情報'],
  ['c', '心得'],
  ['d', '討論'],
  ['e', '攻略'],
  ['f', '秘技'],
  ['g', '閒聊'],
  ['h', '其它'],
];

const SIGNATURES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

export function ReplyComposer({ composer, onSubmit, onClose }: ReplyComposerProps) {
  const [destination, setDestination] = useState<ReplyDestination>('F');
  const [category, setCategory] = useState('g');
  const [title, setTitle] = useState(composer.title);
  const [quote, setQuote] = useState<ReplyQuote>('Y');
  const [signature, setSignature] = useState('0');
  const [body, setBody] = useState('');

  const sending = composer.status === 'sending';
  const done = composer.status === 'done';
  const failed = composer.status === 'error';

  return (
    <div className="bbs-shell bbs-reply" role="dialog" aria-label="回覆文章">
      <header className="bbs-reply-head">
        <div>
          <h2 className="bbs-reply-title-text">回覆文章</h2>
          <p className="bbs-reply-sub">看板《{composer.board}》</p>
        </div>
        <button type="button" className="bbs-nav-btn" onClick={onClose} disabled={sending}>
          {done ? '關閉' : '取消'}
        </button>
      </header>

      <div className="bbs-reply-body">
        <div className="bbs-reply-row">
          <label className="bbs-reply-field">
            <span>回應至</span>
            <select
              value={destination}
              onChange={(e) => setDestination(e.target.value as ReplyDestination)}
              disabled={sending || done}
            >
              <option value="F">看板</option>
              <option value="M">作者信箱</option>
              <option value="B">二者皆是</option>
            </select>
          </label>
          <label className="bbs-reply-field">
            <span>類別</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={sending || done}
            >
              {CATEGORIES.map(([key, label]) => (
                <option key={key} value={key}>
                  {key}) {label}
                </option>
              ))}
            </select>
          </label>
          <label className="bbs-reply-field">
            <span>引用原文</span>
            <select
              value={quote}
              onChange={(e) => setQuote(e.target.value as ReplyQuote)}
              disabled={sending || done}
            >
              <option value="Y">引用</option>
              <option value="N">不引用</option>
              <option value="All">全部引用</option>
            </select>
          </label>
          <label className="bbs-reply-field">
            <span>簽名檔</span>
            <select
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              disabled={sending || done}
            >
              {SIGNATURES.map((value) => (
                <option key={value} value={value}>
                  {value === '0' ? '不加' : value}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="bbs-reply-field bbs-reply-title-field">
          <span>標題</span>
          <input
            className="bbs-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={sending || done}
          />
        </label>

        <label className="bbs-reply-field bbs-reply-content-field">
          <span>內文</span>
          <textarea
            className="bbs-reply-textarea"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={14}
            placeholder="輸入回覆內容…"
            disabled={sending || done}
          />
        </label>

        {composer.message && (
          <p className={`bbs-reply-status${failed ? ' is-error' : ''}`}>{composer.message}</p>
        )}
        <p className="bbs-reply-warn">「確認張貼」會直接發表到 BBS，無法刪除，請先確認內容。</p>
      </div>

      <footer className="bbs-reply-foot">
        <button type="button" className="bbs-nav-btn" onClick={onClose} disabled={sending}>
          取消
        </button>
        <button
          type="button"
          className="bbs-nav-btn bbs-reply-send"
          onClick={() => onSubmit({ destination, category, title, quote, signature, body })}
          disabled={sending || done || body.trim().length === 0}
        >
          {sending ? '傳送中…' : done ? '已送出' : '確認張貼'}
        </button>
      </footer>
    </div>
  );
}
