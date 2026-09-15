import { useState, type FormEvent } from 'react';
import type { BbsPage } from '../../utils/bbsScreen';
import type { BbsActions } from './types';

type LoginBbsPage = Extract<BbsPage, { kind: 'login' }>;

export interface LoginPageProps {
  page: LoginBbsPage;
  actions: BbsActions;
}

/**
 * Credential prompt. Values go to the BBS as raw bytes and are kept in memory
 * for the session so the app can auto-login after the BBS drops the connection;
 * they are never written to storage.
 */
export function LoginPage({ page, actions }: LoginPageProps) {
  const [value, setValue] = useState('');
  const isPassword = page.field === 'password';
  const label = isPassword ? '勇者密碼' : '勇者代號';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!value) return;
    actions.submitLogin(page.field, value);
    setValue('');
  };

  return (
    <section className="bbs-login" aria-label="登入">
      <form className="bbs-login-card" onSubmit={submit}>
        <p className="bbs-login-prompt">{page.prompt}</p>
        <label className="bbs-field">
          <span className="bbs-field-label">{label}</span>
          <input
            className="bbs-input"
            type={isPassword ? 'password' : 'text'}
            value={value}
            autoComplete="off"
            autoFocus
            spellCheck={false}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        <button className="bbs-primary-btn" type="submit" disabled={!value}>
          送出
        </button>
        <p className="bbs-login-hint">
          按 Enter 送出。認證資訊僅保留於本次瀏覽記憶體中（用於斷線重連），不會寫入儲存空間。
        </p>
      </form>
    </section>
  );
}
