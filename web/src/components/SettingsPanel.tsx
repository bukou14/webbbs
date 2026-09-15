import { useEffect } from 'react';
import './SettingsPanel.css';

export type AppSettings = {
  fontSize: number;
};

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSettingsChange: (s: AppSettings) => void;
}

export function SettingsPanel({ isOpen, onClose, settings, onSettingsChange }: SettingsPanelProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <h3>Settings</h3>
        <button type="button" className="close-btn" onClick={onClose} aria-label="關閉設定">×</button>
      </div>
      <div className="settings-body">
        <div className="setting-group">
          <label htmlFor="fontSize">
            Font Size: <span>{settings.fontSize}px</span>
          </label>
          <input
            id="fontSize"
            type="range"
            min="12"
            max="24"
            step="1"
            value={settings.fontSize}
            onChange={(e) => onSettingsChange({ ...settings, fontSize: parseInt(e.target.value, 10) })}
          />
        </div>

      </div>
    </div>
  );
}
