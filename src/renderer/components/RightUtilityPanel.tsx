import { Browser as BrowserIcon, TerminalWindow } from '@phosphor-icons/react';
import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { BrowserSurface, type BrowserPort } from '../features/browser';
import { TerminalSurface, type TerminalPort } from '../features/terminal';

export type UtilityTab = 'terminal' | 'browser';

export interface RightUtilityPanelProps {
  terminalPort?: TerminalPort | null;
  browserPort?: BrowserPort | null;
  theme?: 'light' | 'dark';
  defaultTab?: UtilityTab;
}

export function RightUtilityPanel({ terminalPort, browserPort, theme = 'light', defaultTab = 'terminal' }: RightUtilityPanelProps) {
  const [activeTab, setActiveTab] = useState<UtilityTab>(defaultTab);

  return (
    <Tabs
      aria-label="工具面板"
      className="oa-utility"
      onValueChange={(value) => setActiveTab(value as UtilityTab)}
      value={activeTab}
    >
      <TabsList className="oa-utility__tabs" variant="line">
        <TabsTrigger value="terminal">
          <TerminalWindow aria-hidden="true" size={14} />
          <span>终端</span>
          {terminalPort ? <i aria-label="已连接" /> : null}
        </TabsTrigger>
        <TabsTrigger value="browser">
          <BrowserIcon aria-hidden="true" size={14} />
          <span>浏览器</span>
          {browserPort ? <i aria-label="已连接" /> : null}
        </TabsTrigger>
      </TabsList>

      <TabsContent
        className="oa-utility__surface"
        value="terminal"
      >
        <TerminalSurface port={terminalPort} theme={theme} />
      </TabsContent>
      <TabsContent
        className="oa-utility__surface"
        value="browser"
      >
        <BrowserSurface port={browserPort} />
      </TabsContent>
    </Tabs>
  );
}
