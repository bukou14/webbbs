import { useState } from 'react';
import { SettingsPanel, type AppSettings } from './components/SettingsPanel';
import { BbsBrowserShell } from './components/bbs/BbsBrowserShell';
import { ThreadReader } from './components/bbs/ThreadReader';
import { ReplyComposer } from './components/bbs/ReplyComposer';
import { useBbsSession } from './hooks/useBbsSession';
import './App.css';

export default function App() {
  const {
    page,
    rawText,
    status,
    statusText,
    error,
    busy,
    breadcrumbs,
    threadReader,
    composer,
    actions,
    connect,
    disconnect,
    closeThreadReader,
    closeComposer,
    submitReply,
  } = useBbsSession();
  const [settings, setSettings] = useState<AppSettings>({ fontSize: 14 });
  const [showSettings, setShowSettings] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  return (
    <div className="app-container">
      <BbsBrowserShell
        page={page}
        status={status}
        statusText={statusText}
        busy={busy}
        error={error}
        breadcrumbs={breadcrumbs}
        actions={actions}
        onConnect={connect}
        onDisconnect={disconnect}
        onToggleRaw={() => setShowRaw((value) => !value)}
      />

      <button className="floating-settings" type="button" onClick={() => setShowSettings(true)}>
        Settings
      </button>

      {threadReader && <ThreadReader reader={threadReader} onClose={closeThreadReader} />}

      {composer && (
        <ReplyComposer composer={composer} onSubmit={submitReply} onClose={closeComposer} />
      )}

      {showRaw && (
        <div className="raw-overlay" role="dialog" aria-label="Raw BBS screen">
          <div className="raw-overlay-head">
            <span>Raw BBS screen</span>
            <button type="button" onClick={() => setShowRaw(false)}>
              Close
            </button>
          </div>
          <pre className="raw-overlay-body" style={{ fontSize: settings.fontSize }}>
            {rawText || '(waiting for BBS output…)'}
          </pre>
        </div>
      )}

      <SettingsPanel
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        settings={settings}
        onSettingsChange={setSettings}
      />
    </div>
  );
}
