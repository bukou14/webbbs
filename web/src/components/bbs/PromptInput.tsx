import { useState, type FormEvent } from 'react';

export interface PromptInputProps {
  prompt: string;
  onSubmit: (value: string) => void;
  autoFocus?: boolean;
}

/**
 * Generic BBS text input: a prompt line plus a single field. Empty submissions
 * are allowed because a blank value often means "any" on the BBS.
 */
export function PromptInput({ prompt, onSubmit, autoFocus = true }: PromptInputProps) {
  const [value, setValue] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(value);
    setValue('');
  };

  return (
    <form className="bbs-prompt" onSubmit={submit}>
      <p className="bbs-login-prompt">{prompt}</p>
      <label className="bbs-field">
        <span className="bbs-field-label">輸入</span>
        <input
          className="bbs-input"
          type="text"
          value={value}
          autoComplete="off"
          autoFocus={autoFocus}
          spellCheck={false}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <button className="bbs-primary-btn" type="submit">
        送出
      </button>
    </form>
  );
}
