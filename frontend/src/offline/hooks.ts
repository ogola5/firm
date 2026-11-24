import { useEffect, useState } from "react";
import { API_BASE } from "./api";
import { checkReachability, connectionState, subscribeConnection, type ConnectionState } from "./network";
import { outboxCounts, subscribeOutbox } from "./outbox";
import { getSyncEngine, type SyncState } from "./sync";

/** Live connection state, with an actual reachability probe every 30 seconds. */
export function useConnection(): ConnectionState {
  const [state, setState] = useState(connectionState);
  useEffect(() => {
    const update = () => setState(connectionState());
    const stop = subscribeConnection(update);
    void checkReachability(API_BASE).then(update);
    const timer = setInterval(() => void checkReachability(API_BASE).then(update), 30_000);
    return () => {
      stop();
      clearInterval(timer);
    };
  }, []);
  return state;
}

export function useSyncState(actorId: string): { sync: SyncState; pending: number; conflicts: number; rejected: number } {
  const engine = getSyncEngine();
  const [sync, setSync] = useState(engine.state);
  const [counts, setCounts] = useState({ pending: 0, conflicts: 0, rejected: 0 });
  useEffect(() => {
    const refreshCounts = () => void outboxCounts(actorId).then(setCounts);
    refreshCounts();
    const stopEngine = engine.subscribe(() => {
      setSync(engine.state);
      refreshCounts();
    });
    const stopOutbox = subscribeOutbox(refreshCounts);
    return () => {
      stopEngine();
      stopOutbox();
    };
  }, [actorId, engine]);
  return { sync, ...counts };
}
