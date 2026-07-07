import { useEffect } from "react";
import { useStore } from "./state/store";
import { AIPanel } from "./ui/AIPanel";
import { BrowserPanel } from "./ui/BrowserPanel";
import { Dialogs } from "./ui/dialogs";
import { Ribbon } from "./ui/Ribbon";
import { Timeline } from "./ui/Timeline";
import { Viewport } from "./ui/Viewport";

export function App() {
  const init = useStore((s) => s.init);
  const error = useStore((s) => s.error);
  const clearError = useStore((s) => s.clearError);

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <div className="app">
      <Ribbon />
      <div className="main">
        <BrowserPanel />
        <div className="center">
          <Viewport />
          <Timeline />
        </div>
        <AIPanel />
      </div>
      <Dialogs />
      {error && (
        <div className="toast" onClick={clearError}>
          {error} <span className="muted">(click to dismiss)</span>
        </div>
      )}
    </div>
  );
}
