// Settings screen (M4): speech rate 0.7-1.2x, batch threshold (off/2/4/6/8),
// TTS check-up (test utterance + voice inventory + offline-pack hint).
// Settings persist per browser in their own IndexedDB store.

import { useEffect, useState } from 'react';
import { getSpeaker } from '../app';
import { DEFAULT_SETTINGS, getSettings, saveSettings, type AppSettings } from '../store/db';

const RATES = [0.7, 0.8, 0.9, 1.0, 1.1, 1.2];
const THRESHOLDS: (number | null)[] = [null, 2, 4, 6, 8];
const TEST_SENTENCE = '语音体检。0603 电阻，10千欧，板子左上，靠 Type-C 座。';

export function SettingsScreen(props: { onDone(): void }) {
  const [s, setS] = useState<AppSettings | null>(null);
  const [voices, setVoices] = useState<{ name: string; lang: string }[]>([]);
  const [, setVoiceVer] = useState(0);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    void getSettings().then((loaded) => {
      setS(loaded);
      getSpeaker().setRate(loaded.rate);
      getSpeaker().setVoice(loaded.voiceName ?? null);
    });
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    const load = () => {
      if (!synth) return;
      setVoices(synth.getVoices().map((v) => ({ name: v.name, lang: v.lang })));
      setVoiceVer((x) => x + 1); // re-render the picker when voices arrive
    };
    load();
    synth?.addEventListener?.('voiceschanged', load);
    return () => synth?.removeEventListener?.('voiceschanged', load);
  }, []);

  const update = (patch: Partial<AppSettings>) => {
    if (!s) return;
    const next = { ...s, ...patch };
    setS(next);
    if (patch.rate !== undefined) getSpeaker().setRate(next.rate);
    if (patch.voiceName !== undefined) getSpeaker().setVoice(next.voiceName ?? null);
    void saveSettings(next).then(() => {
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 900);
    });
  };

  const zhVoices = voices.filter((v) => v.lang.toLowerCase().startsWith('zh'));

  return (
    <div class="screen">
      <div class="topbar">
        <h1>设置</h1>
        <button class="btn btn-small" data-testid="settings-done" onClick={props.onDone}>
          完成
        </button>
      </div>
      <div class="stack">
        {!s ? (
          <div class="muted">载入中…</div>
        ) : (
          <>
            <section class="settings-card">
              <h2>语速</h2>
              <div class="chip-row" data-testid="rate-row">
                {RATES.map((r) => (
                  <button
                    key={r}
                    class={`chip ${Math.abs(s.rate - r) < 0.001 ? 'chip-on' : ''}`}
                    data-testid={`rate-${r}`}
                    onClick={() => update({ rate: r })}
                  >
                    {r.toFixed(2)}×
                  </button>
                ))}
              </div>
            </section>

            <section class="settings-card">
              <h2>批量模式阈值</h2>
              <div class="chip-row" data-testid="threshold-row">
                {THRESHOLDS.map((t) => (
                  <button
                    key={String(t)}
                    class={`chip ${s.batchThreshold === t ? 'chip-on' : ''}`}
                    data-testid={`threshold-${t === null ? 'off' : t}`}
                    onClick={() => update({ batchThreshold: t })}
                  >
                    {t === null ? '关闭' : `≥ ${t} 颗`}
                  </button>
                ))}
              </div>
              <div class="muted settings-note">
                进入数量达到阈值的组时询问「一起焊？」；关闭则全程逐颗播报。
              </div>
            </section>

            <section class="settings-card">
              <h2>语音音色</h2>
              <select
                class="voice-select"
                data-testid="voice-select"
                value={s.voiceName ?? ''}
                onChange={(e) => update({ voiceName: e.currentTarget.value || undefined })}
              >
                <option value="">自动（优先最自然的中文音色）</option>
                {(() => {
                  const vs = getSpeaker().listVoices();
                  const zh = vs.filter((v) => v.lang.toLowerCase().startsWith('zh'));
                  const rest = vs.filter((v) => !v.lang.toLowerCase().startsWith('zh'));
                  const opt = (v: { name: string; lang: string }, i: number) => (
                    <option key={i} value={v.name}>{v.name}（{v.lang}）</option>
                  );
                  return [
                    zh.length > 0 && <optgroup key="zh" label="中文">{zh.map(opt)}</optgroup>,
                    rest.length > 0 && <optgroup key="rest" label="其他">{rest.map(opt)}</optgroup>,
                  ];
                })()}
              </select>
              <div class="muted settings-note">
                当前自动选择：{(() => {
                  const vs = getSpeaker().listVoices();
                  const zh = vs.filter((v) => v.lang.toLowerCase().startsWith('zh'));
                  return zh.length > 0 ? zh[0].name : '无中文语音';
                })()}
              </div>
            </section>

            <section class="settings-card">
              <h2>TTS 体检</h2>
              <button
                class="btn btn-primary settings-test"
                data-testid="tts-test"
                onClick={() => getSpeaker().say(TEST_SENTENCE)}
              >
                ▶ 播放测试句
              </button>
              <div class="muted settings-note" data-testid="voice-info">
                {voices.length === 0
                  ? '未检测到任何语音（speechSynthesis 不可用或无 voice）。'
                  : `可用语音 ${voices.length} 个，其中中文 ${zhVoices.length} 个${
                      zhVoices.length > 0 ? '：' + zhVoices.slice(0, 3).map((v) => v.name).join('、') : ''
                    }。`}
              </div>
              {voices.length > 0 && zhVoices.length === 0 && (
                <div class="settings-hint">
                  没有中文语音：请在系统设置里安装中文（离线）语音包，焊接时才能全程离线播报。
                </div>
              )}
              <div class="muted settings-note">若完全无声，应用会以提示音 + 震动兜底，流程照跑。</div>
            </section>

            {savedFlash && <div class="settings-saved">已保存 ✓</div>}
            <div class="muted settings-note">默认值：语速 {DEFAULT_SETTINGS.rate}×，批量阈值 ≥ {DEFAULT_SETTINGS.batchThreshold} 颗。</div>
          </>
        )}
      </div>
    </div>
  );
}
