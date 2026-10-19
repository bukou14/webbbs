import { useState } from 'react';
import { SettingsPanel, type AppSettings } from './components/SettingsPanel';
import { BbsBrowserShell } from './components/bbs/BbsBrowserShell';
import { ThreadReader } from './components/bbs/ThreadReader';
import { ReplyComposer } from './components/bbs/ReplyComposer';
import { SavedPostsPage } from './components/SavedPostsPage';
import { useBbsSession } from './hooks/useBbsSession';
import './App.css';

type AppView = 'bbs' | 'saved';

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
  const [view, setView] = useState<AppView>('bbs');
  const [settings, setSettings] = useState<AppSettings>({ fontSize: 14 });
  const [showSettings, setShowSettings] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  return (
    <div className="app-container">
      <nav className="app-views" role="tablist" aria-label="檢視切換">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'bbs'}
          className={`app-view-tab${view === 'bbs' ? ' active' : ''}`}
          onClick={() => setView('bbs')}
        >
          BBS 終端機
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'saved'}
          className={`app-view-tab${view === 'saved' ? ' active' : ''}`}
          onClick={() => setView('saved')}
        >
          存檔文章
        </button>
      </nav>

      <div className="app-view">
        {view === 'bbs' ? (
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
            onOpenSettings={() => setShowSettings(true)}
          />
        ) : (
          <SavedPostsPage />
        )}
      </div>

      {view === 'bbs' && threadReader && (
        <ThreadReader reader={threadReader} onClose={closeThreadReader} />
      )}

      {view === 'bbs' && composer && (
        <ReplyComposer composer={composer} onSubmit={submitReply} onClose={closeComposer} />
      )}

      {view === 'bbs' && showRaw && (
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
