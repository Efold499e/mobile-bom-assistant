// App shell: screen routing without a router library.
// home -> (import | settings | run -> summary)

import { useState } from 'react';
import { HomeScreen } from './ui/Home';
import { ImportScreen } from './ui/Import';
import { RunScreen } from './ui/Run';
import { SettingsScreen } from './ui/Settings';
import { SummaryScreen } from './ui/Summary';
import { Speaker } from './speaker/speaker';
import type { Side } from './loader/types';

export interface SideStat {
  side: Side;
  total: number;
  done: number;
}

export interface FinishSummary {
  total: number;
  done: number;
  skipped: number;
  elapsedMs: number;
  sides: SideStat[];
}

export type Screen =
  | { name: 'home' }
  | { name: 'import' }
  | { name: 'settings' }
  | { name: 'run'; taskId: string }
  | { name: 'summary'; taskId: string; finish: FinishSummary };

let speakerSingleton: Speaker | null = null;
export function getSpeaker(): Speaker {
  if (!speakerSingleton) speakerSingleton = new Speaker();
  return speakerSingleton;
}

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });

  switch (screen.name) {
    case 'home':
      return (
        <HomeScreen
          onImport={() => setScreen({ name: 'import' })}
          onSettings={() => setScreen({ name: 'settings' })}
          onRun={(taskId) => setScreen({ name: 'run', taskId })}
        />
      );
    case 'import':
      return <ImportScreen onDone={() => setScreen({ name: 'home' })} onCancel={() => setScreen({ name: 'home' })} />;
    case 'settings':
      return <SettingsScreen onDone={() => setScreen({ name: 'home' })} />;
    case 'run':
      return (
        <RunScreen
          key={screen.taskId}
          taskId={screen.taskId}
          onFinish={(finish) => setScreen({ name: 'summary', taskId: screen.taskId, finish })}
          onExit={() => setScreen({ name: 'home' })}
        />
      );
    case 'summary':
      return <SummaryScreen finish={screen.finish} onHome={() => setScreen({ name: 'home' })} />;
  }
}
