// App shell: screen routing without a router library (4 screens in M1).
// home -> (import | run -> summary)

import { useState } from 'react';
import { HomeScreen } from './ui/Home';
import { ImportScreen } from './ui/Import';
import { RunScreen } from './ui/Run';
import { SummaryScreen } from './ui/Summary';
import { Speaker } from './speaker/speaker';

export interface FinishSummary {
  total: number;
  done: number;
  skipped: number;
  elapsedMs: number;
}

export type Screen =
  | { name: 'home' }
  | { name: 'import' }
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
          onRun={(taskId) => setScreen({ name: 'run', taskId })}
        />
      );
    case 'import':
      return <ImportScreen onDone={() => setScreen({ name: 'home' })} onCancel={() => setScreen({ name: 'home' })} />;
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
